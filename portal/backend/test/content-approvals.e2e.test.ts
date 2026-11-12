import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SessionService } from '../src/platform/auth/session.service';
import { ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

/**
 * H-04 part 2: review and approve. The shared fixture's company_admin/content_creator/auditor roles
 * do not cover both "a creator" and "a separate reviewer/approver" in the same company, so this file
 * grants two extra memberships via a direct owner connection, scoped to this file only:
 *   - adminA (company A): also content_creator - the creator.
 *   - auditorA (company A): also company_marketing_manager - a different person who may review/approve.
 *   - creatorB (company B): already content_creator - the creator.
 *   - groupAdmin: also company_marketing_manager, but scoped to company B only - a different person
 *     who may review/approve company B's content (and a check that this does NOT reach company A).
 */
describe('content review and approval (H-04 part 2)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const grant = (userId: string, companyId: string, role: string) =>
      owner.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`,
        [userId, f.groupId, companyId, role],
      );
    await grant(f.users.adminA, f.companyA, 'content_creator');
    await grant(f.users.auditorA, f.companyA, 'company_marketing_manager');
    await grant(f.users.groupAdmin, f.companyB, 'company_marketing_manager');
    await owner.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const sessions = app.get(SessionService);
    for (const [name, id] of Object.entries(f.users)) {
      cookies.set(name, `dcc_sid=${(await sessions.create({ userId: id })).id}`);
    }
  });
  afterAll(async () => {
    await app.close();
  });

  const call = (
    path: string,
    who?: string,
    init: RequestInit & { origin?: string | null } = {},
  ) => {
    const { origin = ORIGIN, headers, ...rest } = init;
    return fetch(`${base}${path}`, {
      redirect: 'manual',
      ...rest,
      headers: {
        ...(who ? { cookie: cookies.get(who)! } : {}),
        ...(origin ? { origin } : {}),
        ...(rest.body ? { 'content-type': 'application/json' } : {}),
        ...(headers as Record<string, string>),
      },
    });
  };
  const json = async (r: Response) => r.json() as Promise<any>;
  const send = (method: string, path: string, who: string, body?: unknown) =>
    call(path, who, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  it('happy path: submit, review (comment), approve - all audited', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Launch announcement.',
        targetAccountIds: [f.accountA],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${created.id}/submit`, 'adminA'),
    );
    expect(submitted.status).toBe('pending');

    const reviewed = await json(
      await send('POST', `/api/approval-requests/${submitted.id}/review`, 'auditorA', {
        comment: 'Looks good, minor typo fixed verbally.',
      }),
    );
    expect(reviewed.status).toBe('pending');
    expect(reviewed.decisions).toHaveLength(1);
    expect(reviewed.decisions[0]).toMatchObject({ decision: 'commented' });

    const approved = await json(
      await send('POST', `/api/approval-requests/${submitted.id}/approve`, 'auditorA', {}),
    );
    expect(approved.status).toBe('approved');
    expect(approved.decisions.map((d: any) => d.decision)).toEqual(['commented', 'approved']);

    const item = await json(await call(`/api/content-items/${created.id}`, 'adminA'));
    expect(item.status).toBe('approved');

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const actions = (
      await owner.query(
        `select action from audit_events where target_id = $1 order by occurred_at`,
        [created.id],
      )
    ).rows.map((r) => r.action);
    await owner.end();
    expect(actions).toEqual([
      'content.drafted',
      'content.submitted',
      'content.reviewed',
      'content.approved',
    ]);
  });

  it('the creator can never review, approve or reject their own content', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Self-approval attempt.',
        targetAccountIds: [f.accountA],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${created.id}/submit`, 'adminA'),
    );

    expect(
      (
        await send('POST', `/api/approval-requests/${submitted.id}/review`, 'adminA', {
          comment: 'x',
        })
      ).status,
    ).toBe(403);
    expect(
      (await send('POST', `/api/approval-requests/${submitted.id}/approve`, 'adminA', {})).status,
    ).toBe(403);
    expect(
      (await send('POST', `/api/approval-requests/${submitted.id}/reject`, 'adminA', {})).status,
    ).toBe(403);
  });

  it('a role without content.review/content.approve cannot decide, even on their own submission', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'creatorB', {
        companyId: f.companyB,
        body: 'Company B draft.',
        targetAccountIds: [f.accountB],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${created.id}/submit`, 'creatorB'),
    );
    expect(
      (
        await send('POST', `/api/approval-requests/${submitted.id}/review`, 'creatorB', {
          comment: 'x',
        })
      ).status,
    ).toBe(403);
  });

  it("a reviewer scoped to company B cannot act on company A's request (visible via group reach, but not permitted)", async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Company A only.',
        targetAccountIds: [f.accountA],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${created.id}/submit`, 'adminA'),
    );
    // groupAdmin's extra review/approve role is scoped to company B only.
    expect(
      (
        await send('POST', `/api/approval-requests/${submitted.id}/review`, 'groupAdmin', {
          comment: 'x',
        })
      ).status,
    ).toBe(403);
  });

  it('cannot submit twice, and cannot decide on an already-decided request', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Double submit.',
        targetAccountIds: [f.accountA],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${created.id}/submit`, 'adminA'),
    );
    expect((await send('POST', `/api/content-items/${created.id}/submit`, 'adminA')).status).toBe(
      409,
    );

    await send('POST', `/api/approval-requests/${submitted.id}/approve`, 'auditorA', {});
    expect(
      (await send('POST', `/api/approval-requests/${submitted.id}/reject`, 'auditorA', {})).status,
    ).toBe(409);
  });

  it('editing after a decision resets the item to draft; a stale decision no longer moves it', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Will be edited after submit.',
        targetAccountIds: [f.accountA],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${created.id}/submit`, 'adminA'),
    );

    // Edit WHILE the request is still pending (before anyone decides): the item resets to draft and
    // moves to a new current version; the old request is now stale but still 'pending' in the database.
    const edited = await json(
      await send('PATCH', `/api/content-items/${created.id}`, 'adminA', { body: 'Edited body.' }),
    );
    expect(edited.status).toBe('draft');
    const noApproval = await call(`/api/content-items/${created.id}/approval`, 'adminA');
    expect(noApproval.status).toBe(200);
    // Nest sends an empty body for a `null` return value rather than the literal text "null".
    expect(await noApproval.text()).toBe('');

    // The stale request can still be decided (it is recorded history), but it no longer flips the
    // item's current status, since the item has already moved on to a new, undecided version.
    const staleApproval = await send(
      'POST',
      `/api/approval-requests/${submitted.id}/approve`,
      'auditorA',
      {},
    );
    expect(staleApproval.status).toBe(201);
    const itemAfter = await json(await call(`/api/content-items/${created.id}`, 'adminA'));
    expect(itemAfter.status).toBe('draft');
  });

  it("another company's approval request looks like it does not exist: 404", async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'creatorB', {
        companyId: f.companyB,
        body: 'Company B only.',
        targetAccountIds: [f.accountB],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${created.id}/submit`, 'creatorB'),
    );
    // auditorA holds content.review (via company_marketing_manager) but only in company A, with no
    // group-level role at all - unlike groupAdmin, their RLS reach never extends to company B, so the
    // row itself is invisible: a true 404, not the "visible but not permitted" 403 of the test above.
    expect(
      (
        await send('POST', `/api/approval-requests/${submitted.id}/review`, 'auditorA', {
          comment: 'x',
        })
      ).status,
    ).toBe(404);
  });
});

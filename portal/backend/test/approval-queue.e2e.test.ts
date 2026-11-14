import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

/**
 * The reviewers' queue (GET /api/approval-requests). Extra grants scoped to this file only: adminA
 * (creator), auditorA (review + approve via company_marketing_manager in A), creatorB (reviewer in
 * company B only, so a cross-company look is a real RLS/scope test and not just "no permission").
 */
describe('approval queue (H-04)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const grant = (user: string, company: string, role: string) =>
      owner.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`,
        [user, f.groupId, company, role],
      );
    await grant(f.users.adminA, f.companyA, 'content_creator');
    await grant(f.users.auditorA, f.companyA, 'company_marketing_manager');
    await grant(f.users.creatorB, f.companyB, 'content_reviewer');
    await owner.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    base = await listenForTests(app);
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

  const submitDraft = async (body: string) => {
    const draft = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body,
        targetAccountIds: [f.accountA],
      }),
    );
    const request = await json(
      await send('POST', `/api/content-items/${draft.id}/submit`, 'adminA'),
    );
    return { draft, request };
  };

  it('a reviewer sees pending requests of their company, oldest first, with the content item to open', async () => {
    const first = await submitDraft('First in the queue.');
    const second = await submitDraft('Second in the queue.');

    const res = await call('/api/approval-requests', 'auditorA');
    expect(res.status).toBe(200);
    const queue = await json(res);
    const ids = queue.map((q: any) => q.id);
    expect(ids.indexOf(first.request.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(first.request.id)).toBeLessThan(ids.indexOf(second.request.id));
    const row = queue.find((q: any) => q.id === first.request.id);
    expect(row).toMatchObject({
      contentItemId: first.draft.id,
      companyId: f.companyA,
      requestedBy: f.users.adminA,
      status: 'pending',
    });
  });

  it('decided requests leave the default queue and show up under their own status', async () => {
    const { request } = await submitDraft('Will be approved.');
    await send('POST', `/api/approval-requests/${request.id}/approve`, 'auditorA', {});

    const pending = await json(await call('/api/approval-requests', 'auditorA'));
    expect(pending.find((q: any) => q.id === request.id)).toBeUndefined();
    const approved = await json(await call('/api/approval-requests?status=approved', 'auditorA'));
    expect(approved.find((q: any) => q.id === request.id)).toBeTruthy();
  });

  it("a reviewer in another company never sees this company's requests", async () => {
    const { request } = await submitDraft('Company A only.');
    const res = await call('/api/approval-requests', 'creatorB');
    expect(res.status).toBe(200);
    expect((await json(res)).find((q: any) => q.id === request.id)).toBeUndefined();
  });

  it('a role that cannot review is refused, and a bad status is a 400', async () => {
    expect((await call('/api/approval-requests', 'outsider')).status).toBe(403);
    expect((await call('/api/approval-requests?status=nonsense', 'auditorA')).status).toBe(400);
  });
});

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SessionService } from '../src/platform/auth/session.service';
import { ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';
const UNKNOWN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * H-06: in-app notifications (first cut - Q4 of portal/backend/QUESTIONS/QUESTIONS.md, not yet
 * decided by Dawit). Same extra grants as the other content/publishing test files, scoped to this
 * file only: adminA (creator, company_admin already holds publishing.freeze), auditorA (review +
 * approve + publish via company_marketing_manager).
 */
describe('notifications: in-app inbox (H-06, first cut)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    await owner.query(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'content_creator')`,
      [f.users.adminA, f.groupId, f.companyA],
    );
    await owner.query(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'company_marketing_manager')`,
      [f.users.auditorA, f.groupId, f.companyA],
    );
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

  it('submitting content notifies reviewers in the company, never the submitter themselves', async () => {
    const draft = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Please review this.',
        targetAccountIds: [f.accountA],
      }),
    );
    await send('POST', `/api/content-items/${draft.id}/submit`, 'adminA');

    const auditorInbox = await json(await call('/api/notifications', 'auditorA'));
    const submitted = auditorInbox.find(
      (n: any) => n.eventType === 'content.submitted' && n.targetId === draft.id,
    );
    expect(submitted).toBeTruthy();
    expect(submitted.readAt).toBeNull();
    expect(submitted.companyId).toBe(f.companyA);

    const adminInbox = await json(await call('/api/notifications', 'adminA'));
    expect(adminInbox.find((n: any) => n.eventType === 'content.submitted')).toBeUndefined();
  });

  it('approving content notifies the creator, not the approver', async () => {
    const draft = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Approve me.',
        targetAccountIds: [f.accountA],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${draft.id}/submit`, 'adminA'),
    );
    await send('POST', `/api/approval-requests/${submitted.id}/approve`, 'auditorA', {});

    const adminInbox = await json(await call('/api/notifications', 'adminA'));
    const approved = adminInbox.find(
      (n: any) => n.eventType === 'content.approved' && n.targetId === draft.id,
    );
    expect(approved).toBeTruthy();

    const auditorInbox = await json(await call('/api/notifications', 'auditorA'));
    expect(auditorInbox.find((n: any) => n.eventType === 'content.approved')).toBeUndefined();
  });

  it('marking a notification read updates it, and the unreadOnly filter then excludes it', async () => {
    const draft = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Read me.',
        targetAccountIds: [f.accountA],
      }),
    );
    await send('POST', `/api/content-items/${draft.id}/submit`, 'adminA');

    const before = await json(await call('/api/notifications', 'auditorA'));
    const target = before.find(
      (n: any) => n.eventType === 'content.submitted' && n.targetId === draft.id,
    );
    expect(target.readAt).toBeNull();

    const res = await send('POST', `/api/notifications/${target.id}/read`, 'auditorA');
    expect(res.status).toBe(201);
    const read = await json(res);
    expect(read.readAt).not.toBeNull();

    const unread = await json(await call('/api/notifications?unreadOnly=true', 'auditorA'));
    expect(unread.find((n: any) => n.id === target.id)).toBeUndefined();
  });

  it("a person cannot mark someone else's notification as read", async () => {
    const draft = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Not yours.',
        targetAccountIds: [f.accountA],
      }),
    );
    await send('POST', `/api/content-items/${draft.id}/submit`, 'adminA');
    const auditorInbox = await json(await call('/api/notifications', 'auditorA'));
    const target = auditorInbox.find(
      (n: any) => n.eventType === 'content.submitted' && n.targetId === draft.id,
    );

    expect((await send('POST', `/api/notifications/${target.id}/read`, 'adminA')).status).toBe(404);
    expect((await send('POST', `/api/notifications/${UNKNOWN_ID}/read`, 'auditorA')).status).toBe(
      404,
    );
  });

  it("freezing publishing notifies the company's publishers, not the person who froze it", async () => {
    const res = await send('POST', '/api/publishing-freezes', 'adminA', {
      companyId: f.companyA,
      reason: 'incident drill',
    });
    expect(res.status).toBe(201);

    const auditorInbox = await json(await call('/api/notifications', 'auditorA'));
    expect(auditorInbox.find((n: any) => n.eventType === 'publishing.frozen')).toBeTruthy();

    const adminInbox = await json(await call('/api/notifications', 'adminA'));
    expect(adminInbox.find((n: any) => n.eventType === 'publishing.frozen')).toBeUndefined();
  });

  it('a signed-in user with no company role at all still has their own (empty) inbox', async () => {
    const res = await call('/api/notifications', 'outsider');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual([]);
  });
});

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
 * Audit search filters and CSV export (FR-07). Extra grants scoped to this file only: adminA
 * (creator, to generate events), creatorB gets the auditor role in company B so a cross-company
 * export is a real scope test. auditorA already holds audit.read in company A.
 */
describe('audit search and export', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let itemId: string;
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
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'auditor')`,
      [f.users.creatorB, f.groupId, f.companyB],
    );
    await owner.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    base = await listenForTests(app);
    const sessions = app.get(SessionService);
    for (const [name, id] of Object.entries(f.users)) {
      cookies.set(name, `dcc_sid=${(await sessions.create({ userId: id })).id}`);
    }

    const draft = await (
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Audit me.',
        targetAccountIds: [f.accountA],
      })
    ).json();
    itemId = draft.id;
    await send('POST', `/api/content-items/${itemId}/submit`, 'adminA');
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

  it('filters by target, actor, action and time window', async () => {
    const byTarget = await json(await call(`/api/audit?targetId=${itemId}`, 'auditorA'));
    expect(byTarget.length).toBeGreaterThanOrEqual(2); // drafted + submitted
    expect(byTarget.every((e: any) => e.target_id === itemId)).toBe(true);

    const byActor = await json(
      await call(`/api/audit?actorUserId=${f.users.adminA}&targetId=${itemId}`, 'auditorA'),
    );
    expect(byActor.length).toBe(byTarget.length);
    const none = await json(
      await call(`/api/audit?actorUserId=${f.users.auditorA}&targetId=${itemId}`, 'auditorA'),
    );
    expect(none).toEqual([]);

    const submitted = await json(
      await call(`/api/audit?action=content.submitted&targetId=${itemId}`, 'auditorA'),
    );
    expect(submitted).toHaveLength(1);

    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      await json(await call(`/api/audit?from=${encodeURIComponent(future)}`, 'auditorA')),
    ).toEqual([]);
    expect((await call('/api/audit?from=yesterday', 'auditorA')).status).toBe(400);
  });

  it('exports CSV with a header row, and the export itself is audited', async () => {
    const res = await call(`/api/audit/export?targetId=${itemId}`, 'auditorA');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const text = await res.text();
    const [header, ...rows] = text.trim().split('\r\n');
    expect(header).toBe(
      'id,occurred_at,actor_user_id,action,target_type,target_id,company_id,correlation_id,details',
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain('content.submitted');

    const logged = await json(await call('/api/audit?action=audit.exported', 'auditorA'));
    expect(logged).toHaveLength(1);
    expect(logged[0].actor_user_id).toBe(f.users.auditorA);
  });

  it("an auditor in another company never gets this company's events, in the list or the export", async () => {
    const list = await json(await call(`/api/audit?targetId=${itemId}`, 'creatorB'));
    expect(list).toEqual([]);
    const text = await (await call(`/api/audit/export?targetId=${itemId}`, 'creatorB')).text();
    expect(text).not.toContain(f.companyA);
    expect(text).not.toContain('content.submitted');
  });

  it('a role without audit.read cannot search or export', async () => {
    expect((await call('/api/audit', 'adminA')).status).toBe(403);
    expect((await call('/api/audit/export', 'adminA')).status).toBe(403);
  });
});

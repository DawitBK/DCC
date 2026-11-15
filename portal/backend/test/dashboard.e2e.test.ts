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
 * Dashboard numbers and registry gaps. Extra grants scoped to this file only: adminA (creator),
 * auditorA (review/approve/read via company_marketing_manager in A, plus the auditor role it
 * already has), creatorB (content_creator in B already: no review, no incident.read, no report.read).
 */
describe('dashboard and registry gaps', () => {
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

  it('a reviewer sees real counts, and a pending approval and its notification show up', async () => {
    const before = await json(await call('/api/dashboard', 'auditorA'));
    expect(before.accounts).toMatchObject({ total: 1, active: 1, needsAttention: 0 });
    expect(before.pendingApprovals).toBe(0);
    expect(before.openIncidents).toBe(0);
    expect(before.publishedLast7Days).toBe(0);

    const draft = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Dashboard please.',
        targetAccountIds: [f.accountA],
      }),
    );
    await send('POST', `/api/content-items/${draft.id}/submit`, 'adminA');

    const after = await json(await call('/api/dashboard', 'auditorA'));
    expect(after.pendingApprovals).toBe(1);
    expect(after.unreadNotifications).toBe(1);
  });

  it('sections the caller may not see are null (not zero), and only their own company is counted', async () => {
    const dash = await json(await call('/api/dashboard', 'creatorB'));
    expect(dash.accounts).toMatchObject({ total: 1 }); // company B's account only
    expect(dash.pendingApprovals).toBeNull();
    expect(dash.openIncidents).toBeNull();
    expect(dash.publishedLast7Days).toBe(0); // has content.read
  });

  it('a person with no role anywhere gets an all-null dashboard, not an error', async () => {
    const res = await call('/api/dashboard', 'outsider');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      accounts: null,
      pendingApprovals: null,
      publishedLast7Days: null,
      openIncidents: null,
      unreadNotifications: 0,
    });
  });

  it('a group administrator sees the accounts of every company in their group', async () => {
    const dash = await json(await call('/api/dashboard', 'groupAdmin'));
    expect(dash.accounts.total).toBe(2);
  });

  it('registry gaps list accounts missing an owner, backup admin or engine link, then drop them once fixed', async () => {
    expect((await call('/api/reports/registry-gaps', 'creatorB')).status).toBe(403);

    const gaps = await json(await call('/api/reports/registry-gaps', 'auditorA'));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ socialAccountId: f.accountA, companyId: f.companyA });
    expect(gaps[0].missing.sort()).toEqual(['backup_admin', 'engine_channel', 'owner']);

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    await owner.query(
      `update social_accounts set owner_user_id = $2, backup_admin_user_id = $3, engine_channel_id = 'chan-1' where id = $1`,
      [f.accountA, f.users.adminA, f.users.auditorA],
    );
    await owner.end();
    expect(await json(await call('/api/reports/registry-gaps', 'auditorA'))).toEqual([]);
  });
});

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
 * Operations overview (not the engagement analytics the proposal describes - see
 * docs/api/reports.md). Same extra grants as the other content/publishing test files, scoped to
 * this file only: adminA (creator), auditorA (approve + publish + report.read via
 * company_marketing_manager).
 */
describe('reports: operations overview', () => {
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
      `update social_accounts set engine_channel_id = 'engine-channel-a' where id = $1`,
      [f.accountA],
    );
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

  it('a role without report.read cannot see the overview', async () => {
    expect((await call('/api/reports/overview', 'creatorB')).status).toBe(403);
  });

  it('counts reflect real content/publication state, and a company admin sees only their own company', async () => {
    const draft = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Draft only.',
        targetAccountIds: [f.accountA],
      }),
    );
    const toApprove = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Will be approved and published.',
        targetAccountIds: [f.accountA],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${toApprove.id}/submit`, 'adminA'),
    );
    await send('POST', `/api/approval-requests/${submitted.id}/approve`, 'auditorA', {});
    await send('POST', `/api/content-items/${toApprove.id}/publish`, 'auditorA', {
      socialAccountId: f.accountA,
    });

    const res = await call('/api/reports/overview', 'adminA');
    expect(res.status).toBe(200);
    const overview = await json(res);
    expect(overview).toHaveLength(1);
    const companyA = overview[0];
    expect(companyA.companyId).toBe(f.companyA);
    expect(companyA.contentItems.byStatus.draft).toBe(1);
    // The second item was published above, and a published item says so in its own status.
    expect(companyA.contentItems.byStatus.published).toBe(1);
    expect(companyA.contentItems.byStatus.approved).toBeUndefined();
    expect(companyA.contentItems.total).toBe(2);
    expect(companyA.publications.byStatus.published).toBe(1);
    expect(companyA.socialAccounts.total).toBeGreaterThanOrEqual(1);
    expect(draft.status).toBe('draft');
  });

  it('a group administrator sees every company of their own group, never another group', async () => {
    const overview = await json(await call('/api/reports/overview', 'groupAdmin'));
    const companyIds = overview.map((o: any) => o.companyId).sort();
    expect(companyIds).toEqual([f.companyA, f.companyB].sort());
  });
});

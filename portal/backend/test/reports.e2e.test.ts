import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EngineRejectedError, type FakeEngine } from '@dcc/engine-client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OPERATIONAL_ENGINE } from '../src/modules/publishing/operational-engine.provider';
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
  let fake: FakeEngine;
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
    fake = app.get(OPERATIONAL_ENGINE);
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

  it('reads fake-engine account analytics through the report permission and keeps provider labels', async () => {
    const response = await call('/api/reports/analytics?days=14', 'auditorA');
    expect(response.status).toBe(200);
    const reports = await json(response);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      companyId: f.companyA,
      socialAccountId: f.accountA,
      result: { status: 'ok', windowDays: 14 },
    });
    expect(reports[0].result.series.map((series: { label: string }) => series.label)).toEqual([
      'Followers',
      'Impressions',
    ]);
    expect((await call('/api/reports/analytics', 'creatorB')).status).toBe(403);
    fake.analyticsAnswers.set('engine-channel-a', {
      status: 'empty',
      windowDays: 30,
      series: [],
    });
    const empty = await json(await call('/api/reports/analytics', 'auditorA'));
    expect(empty[0].result).toMatchObject({ status: 'empty', series: [] });
  });

  describe('analytics: company scope, one failing account, publication path, validation', () => {
    const reportsOf = async (who: string, query = '') =>
      json(await call(`/api/reports/analytics${query}`, who));

    beforeAll(async () => {
      // The test above leaves an 'empty' answer for channel A in the shared fake engine.
      fake.analyticsAnswers.clear();
      const owner = new pg.Client({ connectionString: ownerUrl() });
      await owner.connect();
      // Company B's account is linked to an engine channel too, so isolation is really tested.
      await owner.query(
        `update social_accounts set engine_channel_id = 'engine-channel-b' where id = $1`,
        [f.accountB],
      );
      // A second account in company A, so one failing account can be shown next to a working one.
      await owner.query(
        `insert into social_accounts (company_id, brand_id, platform, display_name, handle, engine_channel_id)
         select company_id, brand_id, 'facebook', 'A page two', '@a2', 'engine-channel-a2'
         from social_accounts where id = $1`,
        [f.accountA],
      );
      await owner.end();
    });

    it("shows a company's own accounts only; a group administrator sees every company of the group", async () => {
      const own = await reportsOf('auditorA');
      expect(own.map((r: any) => r.companyId)).toEqual([f.companyA, f.companyA]);
      expect(own.map((r: any) => r.socialAccountId)).not.toContain(f.accountB);

      const all = await reportsOf('groupAdmin');
      expect(all.map((r: any) => r.socialAccountId)).toContain(f.accountB);
      expect(all.map((r: any) => r.socialAccountId)).toContain(f.accountA);
      expect(all.every((r: any) => [f.companyA, f.companyB].includes(r.companyId))).toBe(true);
    });

    it('shows one account as unavailable and still answers for the others', async () => {
      const original = fake.channelAnalytics.bind(fake);
      const spy = vi.spyOn(fake, 'channelAnalytics').mockImplementation(async (id, days) => {
        if (id === 'engine-channel-a2') throw new EngineRejectedError('limit reached', 429);
        return original(id, days);
      });
      try {
        const response = await call('/api/reports/analytics', 'auditorA');
        expect(response.status).toBe(200);
        const reports = await json(response);
        const failed = reports.find((r: any) => r.displayName === 'A page two');
        const working = reports.find((r: any) => r.displayName === 'A page');
        expect(failed.result).toEqual({
          status: 'unavailable',
          windowDays: 30,
          series: [],
          reason: 'The engine refused the request (429).',
        });
        expect(working.result.status).toBe('ok');

        spy.mockImplementation(async () => {
          throw new Error('socket hang up with internal details');
        });
        const unreachable = await reportsOf('auditorA');
        expect(unreachable.every((r: any) => r.result.status === 'unavailable')).toBe(true);
        // The reason is a fixed sentence: nothing from the error text reaches the person.
        expect(unreachable[0].result.reason).toBe('The engine could not be reached.');
      } finally {
        spy.mockRestore();
      }
    });

    it("reads one publication's analytics, and never another group's publication", async () => {
      const db = new pg.Client({ connectionString: ownerUrl() });
      await db.connect();
      const row = await db.query(
        `select id, engine_operation_id from publications where company_id = $1 and engine_operation_id is not null limit 1`,
        [f.companyA],
      );
      await db.end();
      expect(row.rowCount).toBe(1);
      const publicationId = row.rows[0].id;

      const reports = await reportsOf('auditorA', `?publicationId=${publicationId}`);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ companyId: f.companyA, publicationId });
      expect(reports[0].result.status).toBe('ok');

      // A report reader of another group gets "not found", the same as for an id that does not exist.
      const other = await call(
        `/api/reports/analytics?publicationId=${publicationId}`,
        'otherGroupAdmin',
      );
      expect(other.status).toBe(404);
      const unknown = await call(
        '/api/reports/analytics?publicationId=00000000-0000-4000-8000-000000000000',
        'auditorA',
      );
      expect(unknown.status).toBe(404);
    });

    it('refuses a window over 90 days and a request for an account and a publication together', async () => {
      expect((await call('/api/reports/analytics?days=91', 'auditorA')).status).toBe(400);
      expect((await call('/api/reports/analytics?days=0', 'auditorA')).status).toBe(400);
      const both = await call(
        `/api/reports/analytics?socialAccountId=${f.accountA}&publicationId=${f.accountA}`,
        'auditorA',
      );
      expect(both.status).toBe(400);
    });
  });
});

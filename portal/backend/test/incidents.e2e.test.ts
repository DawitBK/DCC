import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FakeEngine } from '@dcc/engine-client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OPERATIONAL_ENGINE } from '../src/modules/publishing/operational-engine.provider';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';
const UNKNOWN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * H-06 incidents, first cut. None of the shared fixture's roles hold incident.manage (company_admin
 * only has incident.read), so this file grants auditorA an extra company_executive role in company A
 * (incident.read + incident.manage), scoped to this file only.
 */
describe('incidents (H-06)', () => {
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
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'company_executive')`,
      [f.users.auditorA, f.groupId, f.companyA],
    );
    // creatorB holds incident.read/manage in company B only, so a cross-company attempt against
    // company A genuinely tests RLS invisibility (404), not just "lacks the permission everywhere".
    await owner.query(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'company_executive')`,
      [f.users.creatorB, f.groupId, f.companyB],
    );
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-1' where id = $1`,
      [f.accountA],
    );
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-2' where id = $1`,
      [f.accountB],
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

  it('incident.manage can register an incident, optionally tied to an account, and it is audited', async () => {
    const res = await send('POST', '/api/incidents', 'auditorA', {
      companyId: f.companyA,
      socialAccountId: f.accountA,
      title: 'Unexpected admin added',
      severity: 'high',
    });
    expect(res.status).toBe(201);
    const incident = await json(res);
    expect(incident).toMatchObject({
      companyId: f.companyA,
      socialAccountId: f.accountA,
      severity: 'high',
      status: 'open',
    });

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const events = (
      await owner.query(`select action from audit_events where target_id = $1`, [incident.id])
    ).rows;
    await owner.end();
    expect(events.map((e) => e.action)).toContain('incident.opened');
  });

  it('a role with incident.read but not incident.manage can see incidents but not create or update them', async () => {
    const created = await json(
      await send('POST', '/api/incidents', 'auditorA', {
        companyId: f.companyA,
        title: 'Readable',
      }),
    );
    expect((await call('/api/incidents', 'adminA')).status).toBe(200);
    expect((await call(`/api/incidents/${created.id}`, 'adminA')).status).toBe(200);
    expect(
      (await send('POST', '/api/incidents', 'adminA', { companyId: f.companyA, title: 'Nope' }))
        .status,
    ).toBe(403);
    expect(
      (await send('PATCH', `/api/incidents/${created.id}`, 'adminA', { status: 'closed' })).status,
    ).toBe(403);
  });

  it('a role without incident.read at all cannot see incidents', async () => {
    expect((await call('/api/incidents', 'outsider')).status).toBe(403);
  });

  it('resolving sets resolvedAt; reopening clears it', async () => {
    const created = await json(
      await send('POST', '/api/incidents', 'auditorA', {
        companyId: f.companyA,
        title: 'Will resolve',
      }),
    );
    const resolved = await json(
      await send('PATCH', `/api/incidents/${created.id}`, 'auditorA', { status: 'resolved' }),
    );
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).toBeTruthy();

    const reopened = await json(
      await send('PATCH', `/api/incidents/${created.id}`, 'auditorA', { status: 'investigating' }),
    );
    expect(reopened.status).toBe('investigating');
    expect(reopened.resolvedAt).toBeNull();
  });

  it('tying an incident to an unknown or cross-company account is a 400', async () => {
    const unknown = await send('POST', '/api/incidents', 'auditorA', {
      companyId: f.companyA,
      socialAccountId: UNKNOWN_ID,
      title: 'Ghost account',
    });
    expect(unknown.status).toBe(400);
    const crossCompany = await send('POST', '/api/incidents', 'auditorA', {
      companyId: f.companyA,
      socialAccountId: f.accountB,
      title: 'Wrong company account',
    });
    expect(crossCompany.status).toBe(400);
  });

  it("another company's incident looks like it does not exist: 404, and nothing changes", async () => {
    const created = await json(
      await send('POST', '/api/incidents', 'auditorA', {
        companyId: f.companyA,
        title: 'Company A only',
      }),
    );
    expect((await call(`/api/incidents/${created.id}`, 'creatorB')).status).toBe(404);
    expect(
      (await send('PATCH', `/api/incidents/${created.id}`, 'creatorB', { status: 'closed' }))
        .status,
    ).toBe(404);

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const row = (await owner.query(`select status from incidents where id = $1`, [created.id]))
      .rows[0];
    await owner.end();
    expect(row.status).toBe('open');
  });

  it('list is scoped to the caller', async () => {
    const list = await json(await call('/api/incidents', 'auditorA'));
    expect(list.every((i: any) => i.companyId === f.companyA)).toBe(true);
  });

  it('opening an incident notifies other incident.read holders in the company, not the opener', async () => {
    const created = await json(
      await send('POST', '/api/incidents', 'auditorA', {
        companyId: f.companyA,
        title: 'Notify me please',
      }),
    );

    const adminInbox = await json(await call('/api/notifications', 'adminA'));
    const notified = adminInbox.find(
      (n: any) => n.eventType === 'incident.opened' && n.targetId === created.id,
    );
    expect(notified).toBeTruthy();
    expect(notified.readAt).toBeNull();

    const auditorInbox = await json(await call('/api/notifications', 'auditorA'));
    expect(
      auditorInbox.find((n: any) => n.eventType === 'incident.opened' && n.targetId === created.id),
    ).toBeUndefined();
  });

  it('reconcile-bypass creates one high incident per suspected post, updates it on repeat, and scopes companies', async () => {
    fake.posts.set('direct-post-1', {
      engineOperationId: 'direct-post-1',
      engineChannelId: 'fake-linkedin-1',
      state: 'published',
      publishDate: new Date(),
      releaseUrl: 'https://network.example/direct-post-1',
      error: null,
      content: 'Posted outside DCC.',
      networkPostId: 'network-1',
      creationMethod: 'web',
    });

    const first = await json(await send('POST', '/api/publications/reconcile-bypass', 'auditorA'));
    expect(first).toMatchObject({
      checked: 1,
      suspected: 1,
      incidentsCreated: 1,
      incidentsUpdated: 0,
    });
    const incidents = await json(await call('/api/incidents', 'auditorA'));
    const bypass = incidents.find(
      (incident: any) => incident.title === 'Suspected bypass post direct-post-1',
    );
    expect(bypass).toMatchObject({
      companyId: f.companyA,
      socialAccountId: f.accountA,
      severity: 'high',
    });
    expect(JSON.parse(bypass.description)).toMatchObject({
      engineOperationId: 'direct-post-1',
      networkPostId: 'network-1',
      creationMethod: 'web',
    });

    const second = await json(await send('POST', '/api/publications/reconcile-bypass', 'auditorA'));
    expect(second).toMatchObject({ suspected: 1, incidentsCreated: 0, incidentsUpdated: 1 });
    expect(
      (await json(await call('/api/incidents', 'creatorB'))).some((i: any) => i.id === bypass.id),
    ).toBe(false);
    expect(
      (await json(await send('POST', '/api/publications/reconcile-bypass', 'creatorB'))).suspected,
    ).toBe(0);
  });
});

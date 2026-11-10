import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SessionService } from '../src/platform/auth/session.service';
import { ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

describe('HTTP API (real Nest app, real PostgreSQL, real sessions)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let sessions: SessionService;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    sessions = app.get(SessionService);
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
  const post = (path: string, who: string, body: unknown, origin: string | null = ORIGIN) =>
    call(path, who, { method: 'POST', body: JSON.stringify(body), origin });

  it('health endpoints are public; the API sends hardened headers and no CORS', async () => {
    const live = await call('/api/health/live');
    expect(live.status).toBe(200);
    expect((await call('/api/health/ready')).status).toBe(200);
    expect(live.headers.get('x-powered-by')).toBeNull();
    expect(live.headers.get('x-request-id')).toMatch(/^[\w.-]{8,}$/);
    expect(live.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(live.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('metrics are off unless a token is configured', async () => {
    expect((await call('/api/metrics')).status).toBe(404);
  });

  it('everything else needs a session (deny by default)', async () => {
    for (const path of ['/api/me', '/api/companies', '/api/social-accounts', '/api/audit']) {
      expect((await call(path)).status, path).toBe(401);
    }
    const bogus = await call('/api/me', undefined, {
      headers: { cookie: 'dcc_sid=not-a-real-session-id-not-a-real-session-id-0000' },
    });
    expect(bogus.status).toBe(401);
  });

  it('/api/me returns identity, memberships and permissions, and never a token', async () => {
    const res = await call('/api/me', 'adminA');
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.user.email).toBe('admin-a@example.test');
    expect(body.memberships).toEqual([
      { role: 'company_admin', groupId: f.groupId, companyId: f.companyA },
    ]);
    expect(body.permissions).toContain('brand.manage');
    expect(body.permissions).not.toContain('content.publish');
    expect(JSON.stringify(body)).not.toMatch(/token|secret|password/i);
  });

  it('company lists are scoped by membership', async () => {
    expect((await json(await call('/api/companies', 'adminA'))).map((c: any) => c.name)).toEqual([
      'Company A',
    ]);
    expect(
      (await json(await call('/api/companies', 'groupAdmin'))).map((c: any) => c.name),
    ).toEqual(['Company A', 'Company B']);
    // The admin of the OTHER group sees only their own group's company, never Company A or B.
    expect(
      (await json(await call('/api/companies', 'otherGroupAdmin'))).map((c: any) => c.name),
    ).toEqual(['Company Two']);
    expect((await call('/api/companies', 'outsider')).status).toBe(403);
  });

  it('state-changing requests from another origin (or none) are refused: CSRF defence', async () => {
    expect(
      (
        await post(
          '/api/companies',
          'groupAdmin',
          { name: 'X Co', slug: 'x-co' },
          'https://evil.example',
        )
      ).status,
    ).toBe(403);
    expect(
      (await post('/api/companies', 'groupAdmin', { name: 'X Co', slug: 'x-co' }, null)).status,
    ).toBe(403);
  });

  it('only a group administrator can create a company, and the action is audited', async () => {
    expect(
      (await post('/api/companies', 'adminA', { name: 'Nope Co', slug: 'nope-co' })).status,
    ).toBe(403);
    const created = await post('/api/companies', 'groupAdmin', { name: 'New Co', slug: 'new-co' });
    expect(created.status).toBe(201);
    const company = await json(created);
    expect(company).toMatchObject({ name: 'New Co', slug: 'new-co', groupId: f.groupId });

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const events = (
      await owner.query(
        `select action, company_id, actor_user_id from audit_events where action in ('company.created', 'security.access_denied') order by id`,
      )
    ).rows;
    await owner.end();
    // The refused attempt by company admin A is on record, and so is the successful creation.
    expect(
      events.some(
        (e) => e.action === 'security.access_denied' && e.actor_user_id === f.users.adminA,
      ),
    ).toBe(true);
    expect(events.find((e) => e.action === 'company.created')?.company_id).toBe(company.id);
  });

  it('input is validated and duplicates are rejected', async () => {
    const bad = await post('/api/companies', 'groupAdmin', { name: 'x', slug: 'Not A Slug' });
    expect(bad.status).toBe(400);
    expect((await json(bad)).issues.length).toBeGreaterThan(0);
    expect(
      (await post('/api/companies', 'groupAdmin', { name: 'Dup Co', slug: 'new-co' })).status,
    ).toBe(409);
  });

  it("another company's data looks like it does not exist (404, not 403) and cannot be written", async () => {
    expect((await call(`/api/companies/${f.companyB}/brands`, 'adminA')).status).toBe(404);
    expect((await call(`/api/companies/${f.companyA}/brands`, 'adminA')).status).toBe(200);
    expect(
      (
        await post(`/api/companies/${f.companyB}/brands`, 'adminA', {
          name: 'Sneaky',
          slug: 'sneaky',
        })
      ).status,
    ).toBe(404);
    expect((await call('/api/companies/not-a-uuid/brands', 'adminA')).status).toBe(400);
  });

  it('a role without the permission is refused inside its own company', async () => {
    // creatorB may read brands of B but not manage them.
    expect((await call(`/api/companies/${f.companyB}/brands`, 'creatorB')).status).toBe(200);
    expect(
      (
        await post(`/api/companies/${f.companyB}/brands`, 'creatorB', {
          name: 'Brand Z',
          slug: 'brand-z',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post(`/api/companies/${f.companyB}/brands`, 'groupAdmin', {
          name: 'Brand Z',
          slug: 'brand-z',
        })
      ).status,
    ).toBe(201);
  });

  it('social accounts and audit reads are scoped to the caller', async () => {
    expect(
      (await json(await call('/api/social-accounts', 'adminA'))).map((a: any) => a.displayName),
    ).toEqual(['A page']);
    expect(
      (await json(await call('/api/social-accounts', 'groupAdmin'))).map((a: any) => a.displayName),
    ).toEqual(['A page', 'B page']);
    // Generate one audited event in each of A and B, then check the auditor of company A sees only A's.
    expect(
      (
        await post(`/api/companies/${f.companyA}/brands`, 'groupAdmin', {
          name: 'Brand A2',
          slug: 'brand-a2',
        })
      ).status,
    ).toBe(201);
    const audit = await json(await call('/api/audit', 'auditorA'));
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((e: any) => e.company_id === f.companyA)).toBe(true);
    expect(audit.map((e: any) => e.action)).toContain('brand.created');
    expect((await call('/api/audit', 'creatorB')).status).toBe(403);
    expect(await json(await call('/api/audit/verify', 'auditorA'))).toMatchObject({ ok: true });
  });

  it('a failed sign-in callback lands on one generic page and is audited', async () => {
    const res = await call('/api/auth/callback?code=abc&state=unknown');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/?error=signin_failed`);
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const row = (
      await owner.query(`select details from audit_events where action = 'auth.login_failed'`)
    ).rows[0];
    await owner.end();
    expect(row.details.reason).toBe('unknown_state');
  });

  it('back-channel logout always answers 200 and ignores a bad token', async () => {
    const res = await call('/api/auth/backchannel-logout', undefined, {
      method: 'POST',
      origin: null,
      body: JSON.stringify({ logout_token: 'garbage' }),
    });
    expect(res.status).toBe(200);
    expect((await call('/api/me', 'adminA')).status).toBe(200);
  });

  it('idle sessions expire; disabled users are locked out at once', async () => {
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    try {
      await owner.query(
        `update sessions set last_seen_at = now() - interval '2 hours' where user_id = $1`,
        [f.users.outsider],
      );
      expect((await call('/api/me', 'outsider')).status).toBe(401);

      await owner.query(`update users set status = 'disabled' where id = $1`, [f.users.auditorA]);
      expect((await call('/api/me', 'auditorA')).status).toBe(401);
    } finally {
      await owner.end();
    }
  });

  it('logout ends the session', async () => {
    const res = await post('/api/auth/logout', 'creatorB', {});
    expect(res.status).toBe(200);
    expect((await call('/api/me', 'creatorB')).status).toBe(401);
  });
});

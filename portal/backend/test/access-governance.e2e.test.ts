import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';
// A well-formed UUID (correct version/variant nibbles, so it passes zod's z.uuid() and
// ParseUUIDPipe) that does not exist in any table - exercises the FK-violation / not-found
// branches in the service, rather than zod's own format validation.
const UNKNOWN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * H-03: people and roles. Role-grant scope confirmed with Dawit: a company_admin may grant/revoke any
 * company-scoped role (including another company_admin) inside their own company only, never a
 * group-level role; only a group-level permission holder can grant a group-level role. Self-grant is
 * always refused.
 */
describe('access governance (H-03)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
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

  const auditedFor = async (targetId: string) => {
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const rows = (
      await owner.query(
        `select action from audit_events where target_id = $1 order by occurred_at`,
        [targetId],
      )
    ).rows.map((r) => r.action);
    await owner.end();
    return rows;
  };

  it('a role without user.read cannot list people', async () => {
    expect((await call('/api/users', 'creatorB')).status).toBe(403);
    expect((await call('/api/users', 'auditorA')).status).toBe(403);
  });

  it('people are scoped to the caller: a company administrator sees only their own company', async () => {
    const res = await call('/api/users', 'adminA');
    expect(res.status).toBe(200);
    const emails = (await json(res)).map((u: any) => u.email).sort();
    expect(emails).toEqual(['admin-a@example.test', 'auditor-a@example.test']);
  });

  it('a group administrator sees every company of their own group, never another group', async () => {
    const res = await call('/api/users', 'groupAdmin');
    expect(res.status).toBe(200);
    const emails = (await json(res)).map((u: any) => u.email).sort();
    expect(emails).toEqual([
      'admin-a@example.test',
      'auditor-a@example.test',
      'creator-b@example.test',
      'group-admin@example.test',
    ]);
    expect(emails).not.toContain('other-group-admin@example.test');
  });

  it('a group administrator can grant a group-level role, and it is audited', async () => {
    const res = await send('POST', '/api/memberships', 'groupAdmin', {
      userId: f.users.outsider,
      role: 'group_marketing',
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({ role: 'group_marketing', companyId: null, groupId: f.groupId });
    expect(await auditedFor(body.id)).toContain('access.membership_granted');
  });

  it('a company administrator can grant a company-scoped role in their own company, including another company_admin', async () => {
    const res = await send('POST', '/api/memberships', 'adminA', {
      userId: f.users.outsider,
      role: 'company_admin',
      companyId: f.companyA,
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({
      role: 'company_admin',
      companyId: f.companyA,
      groupId: f.groupId,
    });
  });

  it('a company administrator cannot grant a group-level role', async () => {
    // No companyId at all: falls back to "does the caller hold a group-level permission?" - they don't.
    const asGroupGrant = await send('POST', '/api/memberships', 'adminA', {
      userId: f.users.creatorB,
      role: 'group_cto',
    });
    expect(asGroupGrant.status).toBe(403);

    // companyId supplied, but the role itself cannot be held at company scope - refused before any
    // permission check even runs.
    const wrongScope = await send('POST', '/api/memberships', 'adminA', {
      userId: f.users.creatorB,
      role: 'group_cto',
      companyId: f.companyA,
    });
    expect(wrongScope.status).toBe(400);
  });

  it('a company administrator cannot grant anything in another company', async () => {
    const res = await send('POST', '/api/memberships', 'adminA', {
      userId: f.users.outsider,
      role: 'content_creator',
      companyId: f.companyB,
    });
    expect(res.status).toBe(404);
  });

  it('a company administrator cannot grant themselves more', async () => {
    const res = await send('POST', '/api/memberships', 'adminA', {
      userId: f.users.adminA,
      role: 'company_executive',
      companyId: f.companyA,
    });
    expect(res.status).toBe(403);
  });

  it('a role without user.manage cannot grant anything', async () => {
    const res = await send('POST', '/api/memberships', 'creatorB', {
      userId: f.users.outsider,
      role: 'content_creator',
      companyId: f.companyB,
    });
    expect(res.status).toBe(403);
  });

  it('granting the same role twice is refused, and granting to an unknown person is a 400', async () => {
    const first = await send('POST', '/api/memberships', 'adminA', {
      userId: f.users.auditorA,
      role: 'content_creator',
      companyId: f.companyA,
    });
    expect(first.status).toBe(201);
    const duplicate = await send('POST', '/api/memberships', 'adminA', {
      userId: f.users.auditorA,
      role: 'content_creator',
      companyId: f.companyA,
    });
    expect(duplicate.status).toBe(409);
    const unknown = await send('POST', '/api/memberships', 'adminA', {
      userId: UNKNOWN_ID,
      role: 'content_creator',
      companyId: f.companyA,
    });
    expect(unknown.status).toBe(400);
  });

  it("an allowed role can revoke, audited; a company administrator cannot revoke another company's membership", async () => {
    const granted = await json(
      await send('POST', '/api/memberships', 'adminA', {
        userId: f.users.outsider,
        role: 'publisher',
        companyId: f.companyA,
      }),
    );
    const revoked = await call(`/api/memberships/${granted.id}`, 'adminA', { method: 'DELETE' });
    expect(revoked.status).toBe(204);
    expect(await auditedFor(granted.id)).toContain('access.membership_revoked');

    // creatorB's own membership belongs to company B; adminA (company A only) cannot see or revoke it.
    const creatorBMembership = await json(await call('/api/users', 'groupAdmin'));
    const membershipId = creatorBMembership.find((u: any) => u.email === 'creator-b@example.test')
      .memberships[0].id;
    expect(
      (await call(`/api/memberships/${membershipId}`, 'adminA', { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it('revoking an unknown membership id is a 404', async () => {
    expect(
      (await call(`/api/memberships/${UNKNOWN_ID}`, 'groupAdmin', { method: 'DELETE' })).status,
    ).toBe(404);
  });
});

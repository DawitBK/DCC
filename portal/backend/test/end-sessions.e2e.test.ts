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
 * Security administration (permission security.manage): ending every DCC session of one person, for
 * example when they leave. Held by the Group CTO and the security administrator, at group level only;
 * it asks for a recent sign-in like the other sensitive actions; it never touches another group.
 */
describe('end a person’s sessions (security.manage)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let sessions: SessionService;
  const cookie = new Map<string, string>();

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    // groupAdmin is also a security administrator in this file; adminA stays a plain company administrator.
    await owner.query(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, null, 'security_admin')`,
      [f.users.groupAdmin, f.groupId],
    );
    await owner.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    base = await listenForTests(app);
    sessions = app.get(SessionService);
  });
  afterAll(async () => {
    await app.close();
  });

  const open = async (who: keyof Fixture['users'], authenticatedAt = new Date()) => {
    const made = await sessions.create({ userId: f.users[who], authenticatedAt });
    cookie.set(`${who}:${made.id}`, `dcc_sid=${made.id}`);
    return `dcc_sid=${made.id}`;
  };
  const call = (path: string, cookieHeader: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      redirect: 'manual',
      ...init,
      headers: {
        cookie: cookieHeader,
        origin: ORIGIN,
        ...(init.headers as Record<string, string>),
      },
    });
  const me = async (cookieHeader: string) => (await call('/api/me', cookieHeader)).status;
  const owner = async () => {
    const client = new pg.Client({ connectionString: ownerUrl() });
    await client.connect();
    return client;
  };

  it('a security administrator ends every session of a person in their group, and it is audited', async () => {
    const admin = await open('groupAdmin');
    const target1 = await open('adminA');
    const target2 = await open('adminA');
    expect(await me(target1)).toBe(200);

    const res = await call(`/api/users/${f.users.adminA}/end-sessions`, admin, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ended: 2 });

    // Both sessions are gone at once; the person is not disabled and keeps their roles.
    expect(await me(target1)).toBe(401);
    expect(await me(target2)).toBe(401);
    const db = await owner();
    const events = (
      await db.query(
        `select details, actor_user_id from audit_events where action = 'security.sessions_ended' and target_id = $1`,
        [f.users.adminA],
      )
    ).rows;
    const roles = (
      await db.query(`select count(*)::int as n from memberships where user_id = $1`, [
        f.users.adminA,
      ])
    ).rows[0].n;
    await db.end();
    expect(events).toHaveLength(1);
    expect(events[0].details).toEqual({ ended: 2 });
    expect(events[0].actor_user_id).toBe(f.users.groupAdmin);
    expect(roles).toBe(1);
    // The caller's own session is untouched.
    expect(await me(admin)).toBe(200);
  });

  it('ending the sessions of someone who has none is not an error: ended is 0', async () => {
    const admin = await open('groupAdmin');
    const res = await call(`/api/users/${f.users.creatorB}/end-sessions`, admin, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ended: 0 });
  });

  it('a role without security.manage cannot, even a company administrator in the person’s own company', async () => {
    const companyAdmin = await open('adminA');
    const target = await open('auditorA');
    const res = await call(`/api/users/${f.users.auditorA}/end-sessions`, companyAdmin, {
      method: 'POST',
    });
    expect(res.status).toBe(403);
    expect(await me(target)).toBe(200);
  });

  it("another group's security administrator cannot see the person: 404, and nothing ends", async () => {
    const owner2 = await owner();
    await owner2.query(
      `insert into memberships (user_id, group_id, company_id, role)
       select $1, group_id, null, 'security_admin' from memberships where user_id = $1 and role = 'group_admin' limit 1`,
      [f.users.otherGroupAdmin],
    );
    await owner2.end();
    const outsider = await open('otherGroupAdmin');
    const target = await open('creatorB');
    const res = await call(`/api/users/${f.users.creatorB}/end-sessions`, outsider, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    expect(await me(target)).toBe(200);
  });

  it('it asks for a recent sign-in: an old one is answered reauth_required and nothing ends', async () => {
    const stale = await open('groupAdmin', new Date(Date.now() - 20 * 60_000));
    const target = await open('creatorB');
    const res = await call(`/api/users/${f.users.creatorB}/end-sessions`, stale, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('reauth_required');
    expect(await me(target)).toBe(200);
  });

  it('an unknown person is a 404', async () => {
    const admin = await open('groupAdmin');
    const res = await call('/api/users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/end-sessions', admin, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });
});

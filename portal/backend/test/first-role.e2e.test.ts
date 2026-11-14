import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SessionService } from '../src/platform/auth/session.service';
import { appUrl, listenForTests, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

/**
 * The first role of a new person. Found on 2026-11-14 while preparing the real sign-in run: a person who
 * has signed in through the SSO but holds no role yet is invisible to every administrator (row-level
 * security shows people only through a shared company or group), and a role could be granted only by the
 * person's internal id. So nobody could ever be given their FIRST role without database access.
 * Every earlier test passed because it took the id straight from the fixture.
 *
 * `outsider` in the fixture is exactly that person: signed in once, no role.
 */
describe('giving a new person their first role', () => {
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

  const send = (method: string, path: string, who: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      redirect: 'manual',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        cookie: cookies.get(who)!,
        origin: ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    });
  const json = async (r: Response) => r.json() as Promise<any>;
  const emailsSeenBy = async (who: string) =>
    ((await json(await send('GET', '/api/users', who))) as { email: string }[]).map((u) => u.email);

  it('the new person is not in any administrator’s people list (that is by design: no shared company yet)', async () => {
    expect(await emailsSeenBy('groupAdmin')).not.toContain('outsider@example.test');
    expect(await emailsSeenBy('adminA')).not.toContain('outsider@example.test');
  });

  it('a group administrator gives them a first role by email, and then they appear', async () => {
    const res = await send('POST', '/api/memberships', 'groupAdmin', {
      email: 'Outsider@Example.Test',
      companyId: f.companyA,
      role: 'content_creator',
    });
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ role: 'content_creator', companyId: f.companyA });
    expect(await emailsSeenBy('groupAdmin')).toContain('outsider@example.test');

    const me = await json(await send('GET', '/api/me', 'outsider'));
    expect(me.memberships).toEqual([
      expect.objectContaining({ role: 'content_creator', companyId: f.companyA }),
    ]);
  });

  it('a company administrator can do the same inside their own company only', async () => {
    const own = await send('POST', '/api/memberships', 'adminA', {
      email: 'creator-b@example.test',
      companyId: f.companyA,
      role: 'content_reviewer',
    });
    expect(own.status).toBe(201);
    const foreign = await send('POST', '/api/memberships', 'adminA', {
      email: 'outsider@example.test',
      companyId: f.companyB,
      role: 'content_reviewer',
    });
    expect(foreign.status).toBe(404);
  });

  it('an email DCC has never seen is refused with what to do about it', async () => {
    const res = await send('POST', '/api/memberships', 'groupAdmin', {
      email: 'never-signed-in@example.test',
      companyId: f.companyA,
      role: 'content_creator',
    });
    expect(res.status).toBe(400);
    expect((await json(res)).message).toMatch(/has not signed in to DCC yet/);
  });

  it('exactly one of a person id and an email must be given', async () => {
    const both = await send('POST', '/api/memberships', 'groupAdmin', {
      userId: f.users.outsider,
      email: 'outsider@example.test',
      companyId: f.companyA,
      role: 'publisher',
    });
    expect(both.status).toBe(400);
    const neither = await send('POST', '/api/memberships', 'groupAdmin', {
      companyId: f.companyA,
      role: 'publisher',
    });
    expect(neither.status).toBe(400);
  });

  it('giving yourself a role by your own email is refused like any self-grant', async () => {
    const res = await send('POST', '/api/memberships', 'adminA', {
      email: 'admin-a@example.test',
      companyId: f.companyA,
      role: 'publisher',
    });
    expect(res.status).toBe(403);
  });

  it('a person with no role cannot use the lookup to find out who has an account', async () => {
    // Through the API: no permission at all.
    const res = await send('POST', '/api/memberships', 'otherGroupAdmin', {
      email: 'outsider@example.test',
      companyId: f.companyA,
      role: 'publisher',
    });
    expect(res.status).toBe(404); // another group's administrator: the company does not exist for them
    // Straight at the database as the runtime role, with an identity but no company or group: nothing comes back.
    const db = new pg.Client({ connectionString: appUrl() });
    await db.connect();
    try {
      await db.query('begin');
      await db.query(
        `select set_config('app.user_id', $1, true), set_config('app.group_ids', '', true), set_config('app.company_ids', '', true)`,
        [f.users.creatorB],
      );
      const none = await db.query(`select access_find_user_by_email('admin-a@example.test') as id`);
      expect(none.rows[0].id).toBeNull();
      await db.query('rollback');
    } finally {
      await db.end();
    }
  });
});

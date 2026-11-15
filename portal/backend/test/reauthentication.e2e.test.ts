import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import {
  authTimeOf,
  isFreshAuthentication,
  REAUTH_FRESH_SECONDS,
} from '../src/platform/auth/oidc.service';
import { authenticatedRecently, SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

/**
 * L-07: a sensitive action needs a sign-in at the SSO that is recent (DCC_REAUTH_MAX_AGE_MINUTES, 15 in
 * tests), not merely a live session. The three sensitive actions today: granting or removing a role,
 * lifting a publishing freeze, exporting the audit trail.
 */
describe('re-authentication for sensitive actions (L-07)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let sessions: SessionService;

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    // groupAdmin also reads the audit trail in this file.
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

  const cookieFor = async (userId: string, authenticatedAt?: Date | null) =>
    `dcc_sid=${(await sessions.create({ userId, authenticatedAt })).id}`;
  const send = (method: string, path: string, cookie: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      redirect: 'manual',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        cookie,
        origin: ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    });
  const grantBody = () => ({
    userId: f.users.outsider,
    companyId: f.companyA,
    role: 'content_reviewer',
  });

  it('granting a role with an old sign-in is refused with a reason the web app can act on', async () => {
    const stale = await cookieFor(f.users.groupAdmin, minutesAgo(20));
    const res = await send('POST', '/api/memberships', stale, grantBody());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      statusCode: 401,
      code: 'reauth_required',
      message: 'For your security, sign in again to do this.',
    });
  });

  it('the same session still does everything that is not sensitive', async () => {
    const stale = await cookieFor(f.users.groupAdmin, minutesAgo(20));
    expect((await send('GET', '/api/me', stale)).status).toBe(200);
    expect((await send('GET', '/api/users', stale)).status).toBe(200);
    expect((await send('GET', '/api/audit', stale)).status).toBe(200);
    // Freezing is the emergency brake: it must never wait for a sign-in.
    const frozen = await send('POST', '/api/publishing-freezes', stale, { companyId: f.companyA });
    expect(frozen.status).toBe(201);
  });

  it('a sign-in whose time is not known counts as old', async () => {
    const unknown = await cookieFor(f.users.groupAdmin, null);
    const res = await send('POST', '/api/memberships', unknown, grantBody());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('reauth_required');
  });

  it('a recent sign-in may grant and remove a role, lift a freeze and export the audit trail', async () => {
    const fresh = await cookieFor(f.users.groupAdmin, minutesAgo(2));
    const granted = await send('POST', '/api/memberships', fresh, grantBody());
    expect(granted.status).toBe(201);
    const membership = await granted.json();
    expect((await send('DELETE', `/api/memberships/${membership.id}`, fresh)).status).toBe(204);

    const freezes = await (await send('GET', '/api/publishing-freezes', fresh)).json();
    expect(freezes).toHaveLength(1);
    expect((await send('DELETE', `/api/publishing-freezes/${freezes[0].id}`, fresh)).status).toBe(
      204,
    );
    expect((await send('GET', '/api/audit/export', fresh)).status).toBe(200);
  });

  it('removing a role, lifting a freeze and exporting are refused with an old sign-in', async () => {
    const fresh = await cookieFor(f.users.groupAdmin, minutesAgo(1));
    const stale = await cookieFor(f.users.groupAdmin, minutesAgo(16));
    const membership = await (await send('POST', '/api/memberships', fresh, grantBody())).json();
    const freeze = await (
      await send('POST', '/api/publishing-freezes', fresh, { companyId: f.companyB })
    ).json();

    for (const [method, path] of [
      ['DELETE', `/api/memberships/${membership.id}`],
      ['DELETE', `/api/publishing-freezes/${freeze.id}`],
      ['GET', '/api/audit/export'],
    ] as const) {
      const res = await send(method, path, stale);
      expect(res.status, path).toBe(401);
      expect((await res.json()).code, path).toBe('reauth_required');
    }
    // Nothing happened: the role and the freeze are still there.
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const left = await owner.query(
      `select (select count(*) from memberships where id = $1) as m,
              (select count(*) from publishing_freezes where id = $2) as f`,
      [membership.id, freeze.id],
    );
    await owner.end();
    expect(left.rows[0]).toEqual({ m: '1', f: '1' });
  });

  it('someone who may not do the action at all is told "forbidden", not "sign in again"', async () => {
    const stale = await cookieFor(f.users.creatorB, minutesAgo(60));
    const res = await send('POST', '/api/memberships', stale, grantBody());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBeUndefined();
  });

  describe('the rules themselves', () => {
    it('authenticatedRecently: inside the window only, and never for an unknown time', () => {
      const now = new Date('2026-11-13T10:00:00Z');
      expect(authenticatedRecently(new Date('2026-11-13T09:45:00Z'), 15, now)).toBe(true);
      expect(authenticatedRecently(new Date('2026-11-13T09:44:59Z'), 15, now)).toBe(false);
      expect(authenticatedRecently(null, 15, now)).toBe(false);
    });

    it('auth_time is read only when it is a real time', () => {
      expect(authTimeOf(1_794_650_400)?.toISOString()).toBe('2026-11-14T10:00:00.000Z');
      for (const bad of [undefined, null, '1794650400', 0, -5, Number.NaN]) {
        expect(authTimeOf(bad)).toBeUndefined();
      }
    });

    it('a re-authentication counts only if the SSO says it happened just now', () => {
      const now = new Date('2026-11-13T10:00:00Z');
      const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);
      expect(isFreshAuthentication(secondsAgo(5), now)).toBe(true);
      expect(isFreshAuthentication(secondsAgo(REAUTH_FRESH_SECONDS), now)).toBe(true);
      // The SSO answered from a session made earlier: the person did not prove anything now.
      expect(isFreshAuthentication(secondsAgo(REAUTH_FRESH_SECONDS + 1), now)).toBe(false);
      expect(isFreshAuthentication(secondsAgo(3600), now)).toBe(false);
      expect(isFreshAuthentication(undefined, now)).toBe(false);
      // A time far in the future is a broken clock or a forged claim, not freshness.
      expect(isFreshAuthentication(secondsAgo(-3600), now)).toBe(false);
    });
  });
});

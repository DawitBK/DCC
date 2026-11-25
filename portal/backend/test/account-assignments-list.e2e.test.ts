import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

/**
 * The registry-wide list of assignments (`GET /api/social-accounts/assignments`, optional `?userId=`): the one read the
 * people screens use to answer "which accounts is this person assigned to?" without one request per account.
 * It must show exactly what the per-account read shows: only accounts of companies where the caller holds
 * `account.manage`, and nothing of another company or another group.
 */
describe('registry-wide assignments list', () => {
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

  const call = (path: string, who: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      redirect: 'manual',
      ...init,
      headers: {
        cookie: cookies.get(who)!,
        origin: ORIGIN,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  const json = async (r: Response) => r.json() as Promise<any>;
  const assign = (accountId: string, who: string, userId: string) =>
    call(`/api/social-accounts/${accountId}/assignments`, who, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });

  it('lists the assignments of every account the caller manages, and can be narrowed to one person', async () => {
    expect((await assign(f.accountA, 'groupAdmin', f.users.auditorA)).status).toBe(201);
    expect((await assign(f.accountB, 'groupAdmin', f.users.creatorB)).status).toBe(201);
    expect((await assign(f.accountA, 'groupAdmin', f.users.creatorB)).status).toBe(201);

    const all = await call('/api/social-accounts/assignments', 'groupAdmin');
    expect(all.status).toBe(200);
    const rows = await json(all);
    expect(rows).toHaveLength(3);
    expect(
      rows.every((r: object) => Object.keys(r).sort().join() === 'id,socialAccountId,userId'),
    ).toBe(true);

    const one = await call(
      `/api/social-accounts/assignments?userId=${f.users.creatorB}`,
      'groupAdmin',
    );
    const mine = await json(one);
    expect(mine.map((r: { socialAccountId: string }) => r.socialAccountId).sort()).toEqual(
      [f.accountA, f.accountB].sort(),
    );
    expect(mine.every((r: { userId: string }) => r.userId === f.users.creatorB)).toBe(true);
  });

  it('a company administrator sees the assignments of their own company only', async () => {
    const res = await call('/api/social-accounts/assignments', 'adminA');
    expect(res.status).toBe(200);
    const rows = await json(res);
    expect(rows).toHaveLength(2);
    expect(rows.every((r: { socialAccountId: string }) => r.socialAccountId === f.accountA)).toBe(
      true,
    );
  });

  it('answers the same as the per-account read for the same account', async () => {
    const perAccount = await json(
      await call(`/api/social-accounts/${f.accountA}/assignments`, 'adminA'),
    );
    const registryWide = (
      await json(await call('/api/social-accounts/assignments', 'adminA'))
    ).filter((r: { socialAccountId: string }) => r.socialAccountId === f.accountA);
    expect(registryWide.map((r: { id: string }) => r.id).sort()).toEqual(
      perAccount.map((r: { id: string }) => r.id).sort(),
    );
  });

  it('needs account.manage: a reader, a person with no role and another group get nothing', async () => {
    // auditorA holds account.read only.
    expect((await call('/api/social-accounts/assignments', 'auditorA')).status).toBe(403);
    // a company-level creator holds neither.
    expect((await call('/api/social-accounts/assignments', 'creatorB')).status).toBe(403);
    // another group's administrator may call it, and sees none of this group's assignments.
    const other = await call('/api/social-accounts/assignments', 'otherGroupAdmin');
    expect(other.status).toBe(200);
    expect(await json(other)).toEqual([]);
    // asking for a person of this group does not leak either.
    const leak = await call(
      `/api/social-accounts/assignments?userId=${f.users.creatorB}`,
      'otherGroupAdmin',
    );
    expect(await json(leak)).toEqual([]);
  });

  it('refuses a userId that is not a UUID instead of guessing', async () => {
    const res = await call('/api/social-accounts/assignments?userId=not-a-uuid', 'groupAdmin');
    expect(res.status).toBe(400);
  });
});

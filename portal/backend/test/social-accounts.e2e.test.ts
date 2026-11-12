import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';
// A well-formed UUID (correct version/variant nibbles, so it passes zod's z.uuid()) that does not
// exist in any table - exercises the FK-violation branch in the service, rather than zod's own
// format validation (a UUID with a bad variant nibble, e.g. all-1s, fails validation before that).
const UNKNOWN_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * H-02: social account registry. Builds on the foundation read-only list (api.e2e.test.ts already
 * covers that it is scoped by membership) with the write operations: create, update, status, backup
 * admin, assign/unassign - plus the attack tests the module guide requires.
 */
describe('social account registry (H-02)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let createdAccountId: string;
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

  it('account.manage can create an account with an owner, and the creation is audited', async () => {
    const res = await send('POST', '/api/social-accounts', 'adminA', {
      companyId: f.companyA,
      platform: 'facebook',
      displayName: 'Company A on Facebook',
      handle: '@company-a',
      ownerUserId: f.users.adminA,
      backupAdminUserId: f.users.auditorA,
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({
      companyId: f.companyA,
      ownerUserId: f.users.adminA,
      backupAdminUserId: f.users.auditorA,
      status: 'active',
    });
    createdAccountId = body.id;

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const events = (
      await owner.query(
        `select action, target_id, company_id from audit_events where action = 'account.created' and target_id = $1`,
        [body.id],
      )
    ).rows;
    await owner.end();
    expect(events).toHaveLength(1);
    expect(events[0].company_id).toBe(f.companyA);
  });

  it('a role without account.manage cannot create an account', async () => {
    const res = await send('POST', '/api/social-accounts', 'creatorB', {
      companyId: f.companyB,
      platform: 'x',
      displayName: 'Nope',
      handle: '@nope',
      ownerUserId: f.users.creatorB,
    });
    expect(res.status).toBe(403);
  });

  it('an account must have an owner, and validation runs before anything is written', async () => {
    const missingOwner = await send('POST', '/api/social-accounts', 'adminA', {
      companyId: f.companyA,
      platform: 'x',
      displayName: 'No owner',
      handle: '@no-owner',
    });
    expect(missingOwner.status).toBe(400);
    expect((await json(missingOwner)).issues.length).toBeGreaterThan(0);
  });

  it('the backup admin must be a different person from the owner', async () => {
    const res = await send('POST', '/api/social-accounts', 'adminA', {
      companyId: f.companyA,
      platform: 'tiktok',
      displayName: 'Same person',
      handle: '@same-person',
      ownerUserId: f.users.adminA,
      backupAdminUserId: f.users.adminA,
    });
    expect(res.status).toBe(400);
  });

  it('creating under a company the caller cannot see 404s instead of writing', async () => {
    const res = await send('POST', '/api/social-accounts', 'adminA', {
      companyId: f.companyB,
      platform: 'x',
      displayName: 'Sneaky',
      handle: '@sneaky',
      ownerUserId: f.users.adminA,
    });
    expect(res.status).toBe(404);
  });

  it('creating with an owner or backup admin that does not exist is a 400, not a 500', async () => {
    const res = await send('POST', '/api/social-accounts', 'adminA', {
      companyId: f.companyA,
      platform: 'youtube',
      displayName: 'Ghost owner',
      handle: '@ghost-owner',
      ownerUserId: UNKNOWN_USER,
    });
    expect(res.status).toBe(400);
  });

  it('an allowed role can update, change status and set the backup admin, each audited', async () => {
    const updated = await send('PATCH', `/api/social-accounts/${f.accountA}`, 'adminA', {
      displayName: 'A page, renamed',
    });
    expect(updated.status).toBe(200);
    expect((await json(updated)).displayName).toBe('A page, renamed');

    const statused = await send('PATCH', `/api/social-accounts/${f.accountA}/status`, 'adminA', {
      status: 'needs_attention',
    });
    expect(statused.status).toBe(200);
    expect((await json(statused)).status).toBe('needs_attention');

    const backupAdmin = await send(
      'PATCH',
      `/api/social-accounts/${f.accountA}/backup-admin`,
      'adminA',
      { backupAdminUserId: f.users.auditorA },
    );
    expect(backupAdmin.status).toBe(200);
    expect((await json(backupAdmin)).backupAdminUserId).toBe(f.users.auditorA);

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const actions = (
      await owner.query(
        `select action from audit_events where target_id = $1 order by occurred_at`,
        [f.accountA],
      )
    ).rows.map((r) => r.action);
    await owner.end();
    expect(actions).toEqual(
      expect.arrayContaining([
        'account.updated',
        'account.status_changed',
        'account.backup_admin_changed',
      ]),
    );
  });

  it('a backup admin equal to the current owner is refused when set on its own', async () => {
    // createdAccountId's owner is adminA (set at creation); setting the backup admin to the same person
    // must be refused even though this call never touches ownerUserId itself.
    const res = await send(
      'PATCH',
      `/api/social-accounts/${createdAccountId}/backup-admin`,
      'adminA',
      { backupAdminUserId: f.users.adminA },
    );
    expect(res.status).toBe(400);
  });

  it('an allowed role can assign and unassign a person, each audited; duplicates and unknown users are refused', async () => {
    const assigned = await send(
      'POST',
      `/api/social-accounts/${f.accountB}/assignments`,
      'groupAdmin',
      {
        userId: f.users.creatorB,
      },
    );
    expect(assigned.status).toBe(201);

    const duplicate = await send(
      'POST',
      `/api/social-accounts/${f.accountB}/assignments`,
      'groupAdmin',
      {
        userId: f.users.creatorB,
      },
    );
    expect(duplicate.status).toBe(409);

    const unknown = await send(
      'POST',
      `/api/social-accounts/${f.accountB}/assignments`,
      'groupAdmin',
      {
        userId: UNKNOWN_USER,
      },
    );
    expect(unknown.status).toBe(400);

    const removed = await call(
      `/api/social-accounts/${f.accountB}/assignments/${f.users.creatorB}`,
      'groupAdmin',
      {
        method: 'DELETE',
      },
    );
    expect(removed.status).toBe(204);

    const removedAgain = await call(
      `/api/social-accounts/${f.accountB}/assignments/${f.users.creatorB}`,
      'groupAdmin',
      { method: 'DELETE' },
    );
    expect(removedAgain.status).toBe(404);
  });

  it('a role with account.read but not account.manage cannot write', async () => {
    expect(
      (await send('PATCH', `/api/social-accounts/${f.accountA}`, 'auditorA', { displayName: 'x' }))
        .status,
    ).toBe(403);
    expect(
      (
        await send('PATCH', `/api/social-accounts/${f.accountA}/status`, 'auditorA', {
          status: 'archived',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send('POST', `/api/social-accounts/${f.accountA}/assignments`, 'auditorA', {
          userId: f.users.auditorA,
        })
      ).status,
    ).toBe(403);
  });

  it("another company's account looks like it does not exist: 404, not 403, and nothing is changed", async () => {
    // adminA manages company A only; account B belongs to company B and is invisible under RLS.
    expect(
      (
        await send('PATCH', `/api/social-accounts/${f.accountB}`, 'adminA', {
          displayName: 'Hijacked',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send('PATCH', `/api/social-accounts/${f.accountB}/status`, 'adminA', {
          status: 'archived',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send('PATCH', `/api/social-accounts/${f.accountB}/backup-admin`, 'adminA', {
          backupAdminUserId: f.users.adminA,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send('POST', `/api/social-accounts/${f.accountB}/assignments`, 'adminA', {
          userId: f.users.adminA,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(`/api/social-accounts/${f.accountB}/assignments/${f.users.adminA}`, 'adminA', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(404);

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const row = (
      await owner.query(`select display_name from social_accounts where id = $1`, [f.accountB])
    ).rows[0];
    await owner.end();
    expect(row.display_name).toBe('B page');
  });

  it('a group administrator reaches every company of their own group, never another group', async () => {
    expect(
      (
        await send('PATCH', `/api/social-accounts/${f.accountA}`, 'groupAdmin', {
          displayName: 'Group-managed A',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send('PATCH', `/api/social-accounts/${f.accountA}`, 'otherGroupAdmin', {
          displayName: 'Stolen',
        })
      ).status,
    ).toBe(404);
  });
});

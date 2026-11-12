import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SessionService } from '../src/platform/auth/session.service';
import { ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';
const UNKNOWN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * H-04, part 1: drafts and versions. The shared fixture's adminA/creatorB do not hold content.create
 * (only content_creator and company_marketing_manager do), so this file grants adminA an EXTRA
 * content_creator membership in company A via a direct owner connection - scoped to this file only,
 * never touching test/helpers.ts (other test files assert exact user/email lists against it).
 */
describe('content drafting and versions (H-04 part 1)', () => {
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
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'content_creator')`,
      [f.users.adminA, f.groupId, f.companyA],
    );
    await owner.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
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

  it('content.create can draft an item with a body and targets, and it is audited', async () => {
    const res = await send('POST', '/api/content-items', 'adminA', {
      companyId: f.companyA,
      body: 'Hello, Company A.',
      targetAccountIds: [f.accountA],
    });
    expect(res.status).toBe(201);
    const draft = await json(res);
    expect(draft).toMatchObject({
      companyId: f.companyA,
      status: 'draft',
      currentVersion: {
        versionNumber: 1,
        body: 'Hello, Company A.',
        targetAccountIds: [f.accountA],
      },
    });
    expect(draft.currentVersionId).toBe(draft.currentVersion.id);

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const events = (
      await owner.query(`select action from audit_events where target_id = $1`, [draft.id])
    ).rows;
    await owner.end();
    expect(events.map((e) => e.action)).toContain('content.drafted');
  });

  it('a role without content.create cannot draft', async () => {
    const res = await send('POST', '/api/content-items', 'auditorA', {
      companyId: f.companyA,
      body: 'Should not work.',
      targetAccountIds: [f.accountA],
    });
    expect(res.status).toBe(403);
  });

  it('creating under a company the caller cannot see 404s instead of writing', async () => {
    const res = await send('POST', '/api/content-items', 'creatorB', {
      companyId: f.companyA,
      body: 'Sneaky.',
      targetAccountIds: [f.accountA],
    });
    expect(res.status).toBe(404);
  });

  it('a target account from another company is refused (the FK is composite on account + company)', async () => {
    const res = await send('POST', '/api/content-items', 'adminA', {
      companyId: f.companyA,
      body: 'Wrong target.',
      targetAccountIds: [f.accountB],
    });
    expect(res.status).toBe(400);
  });

  it('an unknown target account is a 400, not a 500', async () => {
    const res = await send('POST', '/api/content-items', 'adminA', {
      companyId: f.companyA,
      body: 'Ghost target.',
      targetAccountIds: [UNKNOWN_ID],
    });
    expect(res.status).toBe(400);
  });

  it('a draft needs at least one target account', async () => {
    const res = await send('POST', '/api/content-items', 'adminA', {
      companyId: f.companyA,
      body: 'No targets.',
      targetAccountIds: [],
    });
    expect(res.status).toBe(400);
  });

  it('editing makes a new, immutable version; omitting targets keeps the previous ones; it is audited', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'creatorB', {
        companyId: f.companyB,
        body: 'First draft.',
        targetAccountIds: [f.accountB],
      }),
    );
    expect(created.currentVersion.versionNumber).toBe(1);

    const edited = await json(
      await send('PATCH', `/api/content-items/${created.id}`, 'creatorB', {
        body: 'Second draft.',
      }),
    );
    expect(edited.currentVersion).toMatchObject({
      versionNumber: 2,
      body: 'Second draft.',
      targetAccountIds: [f.accountB],
    });
    expect(edited.currentVersionId).not.toBe(created.currentVersionId);

    const history = await json(await call(`/api/content-items/${created.id}/versions`, 'creatorB'));
    expect(history.map((v: any) => v.versionNumber)).toEqual([2, 1]);
    expect(history.find((v: any) => v.versionNumber === 1).body).toBe('First draft.');

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const actions = (
      await owner.query(
        `select action from audit_events where target_id = $1 order by occurred_at`,
        [created.id],
      )
    ).rows.map((r) => r.action);
    await owner.end();
    expect(actions).toEqual(['content.drafted', 'content.version_created']);
  });

  it("another company's content item looks like it does not exist: 404, and nothing changes", async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Company A only.',
        targetAccountIds: [f.accountA],
      }),
    );
    expect((await call(`/api/content-items/${created.id}`, 'creatorB')).status).toBe(404);
    expect(
      (await send('PATCH', `/api/content-items/${created.id}`, 'creatorB', { body: 'Hijacked' }))
        .status,
    ).toBe(404);
    expect((await call(`/api/content-items/${created.id}/versions`, 'creatorB')).status).toBe(404);

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const row = (
      await owner.query(`select version_number from content_versions where content_item_id = $1`, [
        created.id,
      ])
    ).rows;
    await owner.end();
    expect(row).toHaveLength(1);
  });

  it('list is scoped to the caller and get/history on an unknown id is a 404', async () => {
    const asCreatorB = await json(await call('/api/content-items', 'creatorB'));
    expect(asCreatorB.every((i: any) => i.companyId === f.companyB)).toBe(true);

    expect((await call(`/api/content-items/${UNKNOWN_ID}`, 'adminA')).status).toBe(404);
    expect((await call(`/api/content-items/${UNKNOWN_ID}/versions`, 'adminA')).status).toBe(404);
  });
});

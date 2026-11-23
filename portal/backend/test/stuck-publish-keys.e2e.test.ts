import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FakeEngine, PublishRequest } from '@dcc/engine-client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OPERATIONAL_ENGINE } from '../src/modules/publishing/operational-engine.provider';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

/** H-11: reconciliation starts with idempotency keys, including keys with no publication row. */
describe('stuck publishing idempotency keys', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let fake: FakeEngine;
  let owner: pg.Client;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-1' where id = $1`,
      [f.accountA],
    );
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-2' where id = $1`,
      [f.accountB],
    );
    await owner.query(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'content_creator')`,
      [f.users.adminA, f.groupId, f.companyA],
    );
    await owner.query(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'company_marketing_manager')`,
      [f.users.auditorA, f.groupId, f.companyA],
    );
    await owner.query(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'publisher')`,
      [f.users.outsider, f.groupId, f.companyA],
    );
    await owner.query(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'publisher')`,
      [f.users.creatorB, f.groupId, f.companyB],
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

  /** Test only: puts a post straight into the fake engine, the way a post made outside DCC's gate would be there. */
  const seedEnginePost = (request: PublishRequest) => fake.publish(request as never);

  const createApprovedPublication = async (text: string) => {
    const item = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: text,
        targetAccountIds: [f.accountA],
      }),
    );
    const request = await json(
      await send('POST', `/api/content-items/${item.id}/submit`, 'adminA'),
    );
    await send('POST', `/api/approval-requests/${request.id}/approve`, 'auditorA', {});
    const response = await send('POST', `/api/content-items/${item.id}/publish`, 'outsider', {
      socialAccountId: f.accountA,
    });
    expect(response.status).toBe(201);
    return {
      item,
      publication: await json(response),
      key: `${item.id}:1:fake-linkedin-1`,
    };
  };

  const createDraft = async (who: string, companyId: string, accountId: string) =>
    json(
      await send('POST', '/api/content-items', who, {
        companyId,
        body: `Draft for ${companyId}.`,
        targetAccountIds: [accountId],
      }),
    );

  const setStuck = async (
    key: string,
    publicationId: string | null,
    state: 'in_progress' | 'unknown',
    companyId = f.companyA,
  ) => {
    const db = new pg.Client({ connectionString: ownerUrl() });
    await db.connect();
    try {
      if (publicationId) {
        await db.query(
          `update idempotency_keys set state = $1, result = null, updated_at = now() where key = $2`,
          [state, key],
        );
        await db.query(
          `update publications set status = 'pending', engine_operation_id = null where id = $1 and company_id = $2`,
          [publicationId, companyId],
        );
      } else {
        await db.query(`insert into idempotency_keys (key, state, result) values ($1, $2, null)`, [
          key,
          state,
        ]);
      }
    } finally {
      await db.end();
    }
  };

  it('looks at a pending publication whose engine operation id is missing', async () => {
    const { publication, key } = await createApprovedPublication('Pending without engine id.');
    await setStuck(key, publication.id, 'unknown');
    const listPosts = vi.spyOn(fake, 'listPosts');

    const result = await json(await send('POST', '/api/publications/reconcile', 'outsider'));

    expect(listPosts).toHaveBeenCalled();
    expect(result).toMatchObject({ checked: 1, published: 1, failed: 0 });
  });

  it('lists an in-progress key with no publication row for the permitted person', async () => {
    const item = await createDraft('adminA', f.companyA, f.accountA);
    const key = `${item.id}:1:fake-linkedin-1`;
    await setStuck(key, null, 'in_progress');

    const result = await json(await send('POST', '/api/publications/reconcile', 'outsider'));

    expect(result.unresolvedKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ key, state: 'in_progress' })]),
    );
  });

  it('settles one clear engine match and closes the key', async () => {
    const { publication, key } = await createApprovedPublication('One unique stuck match.');
    await setStuck(key, publication.id, 'unknown');

    await send('POST', '/api/publications/reconcile', 'outsider');

    const db = new pg.Client({ connectionString: ownerUrl() });
    await db.connect();
    const keyRow = await db.query(`select state, result from idempotency_keys where key = $1`, [
      key,
    ]);
    const publicationRow = await db.query(
      `select status, engine_operation_id from publications where id = $1`,
      [publication.id],
    );
    await db.end();
    expect(keyRow.rows[0]).toMatchObject({ state: 'done' });
    expect(keyRow.rows[0].result).toMatchObject({ engineOperationId: expect.any(String) });
    expect(publicationRow.rows[0]).toMatchObject({
      status: 'published',
      engine_operation_id: keyRow.rows[0].result.engineOperationId,
    });
  });

  it('keeps two possible matches blocked and does not send again', async () => {
    const { publication, key } = await createApprovedPublication('Two possible stuck matches.');
    await setStuck(key, publication.id, 'unknown');
    const before = fake.posts.size;
    await seedEnginePost({
      idempotencyKey: 'candidate-two',
      dccContentId: 'not-used-for-matching',
      approvalVersion: 1,
      approverUserId: f.users.auditorA,
      companyId: f.companyA,
      channelId: 'fake-linkedin-1',
      text: 'Two possible stuck matches.',
      scheduledAt: null,
      media: [],
    });

    await send('POST', '/api/publications/reconcile', 'outsider');

    expect(fake.posts.size).toBe(before + 1);
    const db = new pg.Client({ connectionString: ownerUrl() });
    await db.connect();
    const keyRow = await db.query(`select state from idempotency_keys where key = $1`, [key]);
    await db.end();
    expect(keyRow.rows[0].state).toBe('unknown');
  });

  it('marks an engine refusal failed and releases the key', async () => {
    const { publication, key } = await createApprovedPublication('Engine refused this post.');
    await setStuck(key, publication.id, 'unknown');
    const post = fake.posts.get(publication.engineOperationId);
    expect(post).toBeDefined();
    Object.assign(post, { state: 'error', error: 'The engine refused this post.' });

    await send('POST', '/api/publications/reconcile', 'outsider');

    const db = new pg.Client({ connectionString: ownerUrl() });
    await db.connect();
    const keyRow = await db.query(`select 1 from idempotency_keys where key = $1`, [key]);
    const row = await db.query(`select status, error from publications where id = $1`, [
      publication.id,
    ]);
    await db.end();
    expect(keyRow.rowCount).toBe(0);
    expect(row.rows[0]).toMatchObject({ status: 'failed', error: 'The engine refused this post.' });
  });

  it('records resolver, time, evidence and reason in the same resolution audit', async () => {
    const { publication, key } = await createApprovedPublication('Audit the stuck resolution.');
    await setStuck(key, publication.id, 'unknown');
    const post = fake.posts.get(publication.engineOperationId);
    expect(post).toBeDefined();
    Object.assign(post, { state: 'error', error: 'Rejected with evidence.' });

    await send('POST', '/api/publications/reconcile', 'outsider');

    const db = new pg.Client({ connectionString: ownerUrl() });
    await db.connect();
    const audit = await db.query(
      `select actor_user_id, occurred_at, details from audit_events where target_type = 'publication' and target_id = $1 order by id desc limit 1`,
      [publication.id],
    );
    await db.end();
    expect(audit.rows[0]).toMatchObject({ actor_user_id: f.users.outsider });
    expect(audit.rows[0].occurred_at).toBeInstanceOf(Date);
    expect(audit.rows[0].details).toMatchObject({
      reason: 'Rejected with evidence.',
      evidence: expect.objectContaining({ engineOperationId: expect.any(String) }),
    });
  });

  it("does not list or resolve another company's stuck key", async () => {
    const item = await createDraft('creatorB', f.companyB, f.accountB);
    const key = `${item.id}:1:fake-linkedin-2`;
    await setStuck(key, null, 'in_progress', f.companyB);

    const result = await json(await send('POST', '/api/publications/reconcile', 'outsider'));

    expect(result.unresolvedKeys ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key })]),
    );
    const otherCompanyResult = await json(
      await send('POST', '/api/publications/reconcile', 'creatorB'),
    );
    expect(otherCompanyResult.unresolvedKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ key })]),
    );
  });

  it('does not match a same-text post created outside DCC or an older post', async () => {
    const { publication, key } = await createApprovedPublication('Only match the DCC post.');
    await setStuck(key, publication.id, 'unknown');
    const dccPost = fake.posts.get(publication.engineOperationId);
    expect(dccPost).toBeDefined();
    Object.assign(dccPost, { state: 'queued', creationMethod: 'web' });
    const older = await seedEnginePost({
      idempotencyKey: 'older-candidate',
      dccContentId: 'older-candidate',
      approvalVersion: 1,
      approverUserId: f.users.auditorA,
      companyId: f.companyA,
      channelId: 'fake-linkedin-1',
      text: 'Only match the DCC post.',
      scheduledAt: null,
      media: [],
    });
    Object.assign(fake.posts.get(older.engineOperationId), {
      publishDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });

    const result = await json(await send('POST', '/api/publications/reconcile', 'outsider'));

    expect(result.unresolvedKeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ key, reason: 'no_match' })]),
    );
  });
});

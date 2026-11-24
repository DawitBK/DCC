import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FakeEngine, PublishRequest } from '@dcc/engine-client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OPERATIONAL_ENGINE } from '../src/modules/publishing/operational-engine.provider';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

/**
 * H-17: what pull request 71 left. A stuck key with no publication row gets its record, a person settles an
 * ambiguous or unmatched key by hand, and a stuck SCHEDULED publication is matched on its scheduled time.
 */
describe('stuck publish keys: follow-ups (H-17)', () => {
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
    const grant = (userId: string, groupId: string, companyId: string | null, role: string) =>
      owner.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`,
        [userId, groupId, companyId, role],
      );
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-1' where id = $1`,
      [f.accountA],
    );
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-2' where id = $1`,
      [f.accountB],
    );
    await grant(f.users.adminA, f.groupId, f.companyA, 'content_creator');
    await grant(f.users.auditorA, f.groupId, f.companyA, 'company_marketing_manager');
    await grant(f.users.outsider, f.groupId, f.companyA, 'publisher');
    await grant(f.users.creatorB, f.groupId, f.companyB, 'publisher');
    // Opens incidents for the whole group (the bypass check).
    await grant(f.users.groupAdmin, f.groupId, null, 'security_admin');
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
  const query = async (text: string, values: unknown[] = []) => {
    const db = new pg.Client({ connectionString: ownerUrl() });
    await db.connect();
    try {
      return (await db.query(text, values)).rows as any[];
    } finally {
      await db.end();
    }
  };

  /** Test only: a post put straight into the fake engine, as if it had been made outside DCC's gate. */
  const seedEnginePost = (text: string, channelId = 'fake-linkedin-1') =>
    fake.publish({
      idempotencyKey: `seed-${Math.random()}`,
      dccContentId: 'not-used-for-matching',
      approvalVersion: 1,
      approverUserId: f.users.auditorA,
      companyId: f.companyA,
      channelId,
      text,
      scheduledAt: null,
      media: [],
    } as unknown as PublishRequest as never);

  /** Written by adminA, approved by auditorA, published by `outsider` through the real gate. */
  const approvedPublication = async (text: string, scheduledAt?: Date) => {
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
      ...(scheduledAt && { scheduledAt: scheduledAt.toISOString() }),
    });
    expect(response.status).toBe(201);
    const publication = await json(response);
    return { item, publication, key: `${item.id}:1:fake-linkedin-1` };
  };

  /** A crash: the engine accepted the post, DCC never saved its record, the key is left in progress. */
  const crashBeforeRecord = async (publicationId: string, key: string) => {
    await query(`delete from publications where id = $1`, [publicationId]);
    await query(
      `update idempotency_keys set state = 'in_progress', result = null, updated_at = now() where key = $1`,
      [key],
    );
  };

  /** A timeout: the row is `pending` with no engine id, the key is `unknown`. */
  const timeout = async (publicationId: string, key: string) => {
    await query(
      `update publications set status = 'pending', engine_operation_id = null where id = $1`,
      [publicationId],
    );
    await query(
      `update idempotency_keys set state = 'unknown', result = null, updated_at = now() where key = $1`,
      [key],
    );
  };

  const settle = (who: string, key: string, body: unknown) =>
    send('POST', `/api/publications/stuck-keys/${encodeURIComponent(key)}/settle`, who, body);

  describe('(a) a key with no publication row that matches one published post', () => {
    it('creates the publication record in the same step, so the post has a DCC record', async () => {
      const { item, publication, key } = await approvedPublication('Crash before the record.');
      await crashBeforeRecord(publication.id, key);
      await query(`update content_items set status = 'approved' where id = $1`, [item.id]);

      const result = await json(await send('POST', '/api/publications/reconcile', 'outsider'));

      expect(result).toMatchObject({ published: 1 });
      const rows = await query(`select * from publications where idempotency_key = $1`, [key]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        company_id: f.companyA,
        content_item_id: item.id,
        social_account_id: f.accountA,
        status: 'published',
        engine_operation_id: publication.engineOperationId,
        // The person who pressed publish is lost with the crash: the resolver is recorded instead.
        requested_by: f.users.outsider,
        approved_by: f.users.auditorA,
      });
      expect(rows[0].completed_at).toBeInstanceOf(Date);
      expect(
        (await query(`select state from idempotency_keys where key = $1`, [key]))[0].state,
      ).toBe('done');
      expect(
        (await query(`select status from content_items where id = $1`, [item.id]))[0].status,
      ).toBe('published');
      const audit = await query(
        `select action, actor_user_id, details from audit_events where target_type = 'publication' and target_id = $1`,
        [rows[0].id],
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'publication.published',
        actor_user_id: f.users.outsider,
      });
      expect(audit[0].details).toMatchObject({
        recordCreatedFromKey: true,
        resolver: f.users.outsider,
        evidence: expect.objectContaining({ engineOperationId: publication.engineOperationId }),
      });
      // The record is visible to the people who read publications.
      const listed = await json(await send('GET', '/api/publications', 'auditorA'));
      expect(listed.map((p: any) => p.id)).toContain(rows[0].id);
    });

    it('the bypass check then does not flag the post, and a repeat reconcile changes nothing', async () => {
      const { publication, key } = await approvedPublication('Crash, then the bypass check.');
      await crashBeforeRecord(publication.id, key);
      await send('POST', '/api/publications/reconcile', 'outsider');

      const bypass = await json(
        await send('POST', '/api/publications/reconcile-bypass', 'groupAdmin'),
      );

      expect(bypass.incidentsCreated).toBe(0);
      const titles = await query(`select title from incidents where title like $1`, [
        `%${publication.engineOperationId}`,
      ]);
      expect(titles).toHaveLength(0);
      const again = await json(await send('POST', '/api/publications/reconcile', 'outsider'));
      expect(again.published).toBe(0);
      expect(
        await query(`select 1 from publications where idempotency_key = $1`, [key]),
      ).toHaveLength(1);
    });

    it("does not create a record for another company's key, and the other company's person can", async () => {
      const { publication, key } = await approvedPublication('Crash seen only by its own company.');
      await crashBeforeRecord(publication.id, key);

      await send('POST', '/api/publications/reconcile', 'creatorB');

      expect(
        await query(`select 1 from publications where idempotency_key = $1`, [key]),
      ).toHaveLength(0);
      expect(
        (await query(`select state from idempotency_keys where key = $1`, [key]))[0].state,
      ).toBe('in_progress');
      await send('POST', '/api/publications/reconcile', 'outsider');
      expect(
        await query(`select 1 from publications where idempotency_key = $1`, [key]),
      ).toHaveLength(1);
    });
  });

  describe('(c) a stuck scheduled publication', () => {
    const inTwoDays = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

    it('is matched on its scheduled time and recorded as scheduled, not left as no_match', async () => {
      const { publication, key } = await approvedPublication(
        'Scheduled, then the answer was lost.',
        inTwoDays(),
      );
      expect(publication.status).toBe('scheduled');
      await timeout(publication.id, key);

      const result = await json(await send('POST', '/api/publications/reconcile', 'outsider'));

      expect(result.scheduled).toBe(1);
      expect(result.unresolvedKeys).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ key })]),
      );
      const row = (await query(`select * from publications where id = $1`, [publication.id]))[0];
      expect(row).toMatchObject({
        status: 'scheduled',
        engine_operation_id: publication.engineOperationId,
        completed_at: null,
      });
      expect(row.scheduled_at).toBeInstanceOf(Date);
      const keyRow = (
        await query(`select state, result from idempotency_keys where key = $1`, [key])
      )[0];
      expect(keyRow).toMatchObject({ state: 'done' });
      expect(keyRow.result).toMatchObject({ engineOperationId: publication.engineOperationId });
      const audit = await query(
        `select action, details from audit_events where target_type = 'publication' and target_id = $1 order by id desc limit 1`,
        [publication.id],
      );
      expect(audit[0].action).toBe('publication.scheduled');
      expect(audit[0].details).toMatchObject({ resolver: f.users.outsider });
    });

    it('the bypass check does not flag the queued post of a stuck scheduled publication', async () => {
      const { publication, key } = await approvedPublication(
        'Scheduled and unsettled.',
        inTwoDays(),
      );
      await timeout(publication.id, key);

      const bypass = await json(
        await send('POST', '/api/publications/reconcile-bypass', 'groupAdmin'),
      );

      expect(bypass.incidentsCreated).toBe(0);
      expect(
        await query(`select 1 from incidents where title like $1`, [
          `%${publication.engineOperationId}`,
        ]),
      ).toHaveLength(0);
    });

    it('stays unmatched when the engine post is not at the scheduled time', async () => {
      const { publication, key } = await approvedPublication(
        'Scheduled at another time.',
        inTwoDays(),
      );
      await timeout(publication.id, key);
      Object.assign(fake.posts.get(publication.engineOperationId)!, {
        publishDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      });

      const result = await json(await send('POST', '/api/publications/reconcile', 'outsider'));

      expect(result.unresolvedKeys).toEqual(
        expect.arrayContaining([expect.objectContaining({ key, reason: 'no_match' })]),
      );
      expect(
        (await query(`select status from publications where id = $1`, [publication.id]))[0].status,
      ).toBe('pending');
    });

    it("another company's person does not settle it", async () => {
      const { publication, key } = await approvedPublication(
        'Scheduled, other company looks.',
        inTwoDays(),
      );
      await timeout(publication.id, key);

      const result = await json(await send('POST', '/api/publications/reconcile', 'creatorB'));

      expect(result.scheduled).toBe(0);
      expect(
        (await query(`select status from publications where id = $1`, [publication.id]))[0].status,
      ).toBe('pending');
    });
  });

  describe('(b) settling a stuck key by hand', () => {
    it('lists the candidates of an ambiguous key, and a person names the right one', async () => {
      const { publication, key } = await approvedPublication('Two posts, one is ours.');
      await timeout(publication.id, key);
      const second = await seedEnginePost('Two posts, one is ours.');

      const reconciled = await json(await send('POST', '/api/publications/reconcile', 'outsider'));
      const entry = reconciled.unresolvedKeys.find((k: any) => k.key === key);
      expect(entry).toMatchObject({ reason: 'ambiguous_match', publicationId: publication.id });
      expect(entry.candidateEngineOperationIds.sort()).toEqual(
        [publication.engineOperationId, second.engineOperationId].sort(),
      );

      const response = await settle('outsider', key, {
        outcome: 'published',
        engineOperationId: publication.engineOperationId,
        reason: 'Checked the post on the network: it is the one we sent.',
      });

      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body).toMatchObject({ key, outcome: 'published' });
      expect(body.publication).toMatchObject({
        id: publication.id,
        status: 'published',
        engineOperationId: publication.engineOperationId,
      });
      expect(
        (await query(`select state from idempotency_keys where key = $1`, [key]))[0].state,
      ).toBe('done');
      const audit = (
        await query(
          `select action, actor_user_id, occurred_at, details from audit_events where target_type = 'publication' and target_id = $1 order by id desc limit 1`,
          [publication.id],
        )
      )[0];
      expect(audit).toMatchObject({
        action: 'publication.published',
        actor_user_id: f.users.outsider,
      });
      expect(audit.occurred_at).toBeInstanceOf(Date);
      expect(audit.details).toMatchObject({
        manual: true,
        resolver: f.users.outsider,
        reason: 'Checked the post on the network: it is the one we sent.',
        evidence: expect.objectContaining({
          engineOperationId: publication.engineOperationId,
          textMatches: true,
        }),
      });
      // Settled for good: a second attempt finds no stuck key.
      expect(
        (await settle('outsider', key, { outcome: 'not_published', reason: 'Again.' })).status,
      ).toBe(404);
    });

    it('settles an unmatched key (a crash, the text was edited in the engine) and creates the record', async () => {
      const { item, publication, key } = await approvedPublication('Edited later in the engine.');
      await crashBeforeRecord(publication.id, key);
      Object.assign(fake.posts.get(publication.engineOperationId)!, { content: 'Edited text.' });
      const reconciled = await json(await send('POST', '/api/publications/reconcile', 'outsider'));
      expect(reconciled.unresolvedKeys).toEqual(
        expect.arrayContaining([expect.objectContaining({ key, reason: 'no_match' })]),
      );

      const response = await settle('outsider', key, {
        outcome: 'published',
        engineOperationId: publication.engineOperationId,
        reason: 'The marketing team shortened the text after it went out.',
      });

      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.publication).toMatchObject({
        contentItemId: item.id,
        socialAccountId: f.accountA,
        status: 'published',
        requestedBy: f.users.outsider,
      });
      const audit = (
        await query(
          `select details from audit_events where target_type = 'publication' and target_id = $1`,
          [body.publication.id],
        )
      )[0];
      expect(audit.details).toMatchObject({
        recordCreatedFromKey: true,
        evidence: expect.objectContaining({ textMatches: false }),
      });
    });

    it('records a queued post as a scheduled publication', async () => {
      const when = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const { publication, key } = await approvedPublication('Scheduled, settled by hand.', when);
      await crashBeforeRecord(publication.id, key);

      const response = await settle('outsider', key, {
        outcome: 'published',
        engineOperationId: publication.engineOperationId,
        reason: 'It is queued in the engine for the planned time.',
      });

      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.outcome).toBe('scheduled');
      expect(body.publication).toMatchObject({ status: 'scheduled' });
      expect(new Date(body.publication.scheduledAt).getTime()).toBe(when.getTime());
    });

    it('declares a key not published and releases it when the engine holds no matching post', async () => {
      const { publication, key } = await approvedPublication('Never reached the engine.');
      await timeout(publication.id, key);
      fake.posts.delete(publication.engineOperationId);

      const response = await settle('outsider', key, {
        outcome: 'not_published',
        reason: 'The engine was down; nothing is on the network.',
      });

      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({ key, outcome: 'not_published' });
      expect(await query(`select 1 from idempotency_keys where key = $1`, [key])).toHaveLength(0);
      const row = (
        await query(`select status, error from publications where id = $1`, [publication.id])
      )[0];
      expect(row.status).toBe('failed');
      expect(row.error).toContain('The engine was down');
      const audit = (
        await query(
          `select action, actor_user_id, details from audit_events where target_type = 'publication' and target_id = $1 order by id desc limit 1`,
          [publication.id],
        )
      )[0];
      expect(audit).toMatchObject({
        action: 'publication.failed',
        actor_user_id: f.users.outsider,
      });
      expect(audit.details).toMatchObject({
        manual: true,
        reason: 'The engine was down; nothing is on the network.',
        evidence: expect.objectContaining({ declaredNotPublished: true }),
      });
    });

    it('refuses to declare a key not published while the engine holds a matching post', async () => {
      const { publication, key } = await approvedPublication('It is in the engine after all.');
      await timeout(publication.id, key);

      const response = await settle('outsider', key, {
        outcome: 'not_published',
        reason: 'I think it did not go out.',
      });

      expect(response.status).toBe(409);
      expect(
        (await query(`select state from idempotency_keys where key = $1`, [key]))[0].state,
      ).toBe('unknown');
      expect(
        (await query(`select status from publications where id = $1`, [publication.id]))[0].status,
      ).toBe('pending');
    });

    it('refuses to name a post that did not come through DCC, is on another channel, is unknown or is taken', async () => {
      const { publication, key } = await approvedPublication('Naming the wrong posts.');
      await timeout(publication.id, key);
      const web = await seedEnginePost('Naming the wrong posts.');
      Object.assign(fake.posts.get(web.engineOperationId)!, { creationMethod: 'web' });
      const elsewhere = await seedEnginePost('Naming the wrong posts.', 'fake-linkedin-2');
      const body = (engineOperationId: string) => ({
        outcome: 'published',
        engineOperationId,
        reason: 'Trying.',
      });

      expect((await settle('outsider', key, body(web.engineOperationId))).status).toBe(409);
      expect((await settle('outsider', key, body(elsewhere.engineOperationId))).status).toBe(409);
      expect((await settle('outsider', key, body('no-such-post'))).status).toBe(400);
      // A post another publication already owns.
      const other = await approvedPublication('Owned by another publication.');
      expect(
        (await settle('outsider', key, body(other.publication.engineOperationId))).status,
      ).toBe(409);
      // An errored post cannot settle a key as published.
      Object.assign(fake.posts.get(web.engineOperationId)!, {
        creationMethod: 'api',
        state: 'error',
      });
      expect((await settle('outsider', key, body(web.engineOperationId))).status).toBe(409);

      expect(
        (await query(`select state from idempotency_keys where key = $1`, [key]))[0].state,
      ).toBe('unknown');
      // The web post is still a suspected bypass: settling did not hide it.
      Object.assign(fake.posts.get(web.engineOperationId)!, {
        creationMethod: 'web',
        state: 'published',
      });
    });

    it('validates the body and the key', async () => {
      const { publication, key } = await approvedPublication('Validation of the settle call.');
      await timeout(publication.id, key);
      expect((await settle('outsider', key, { outcome: 'published', reason: 'x' })).status).toBe(
        400,
      );
      expect((await settle('outsider', key, { outcome: 'not_published' })).status).toBe(400);
      expect((await settle('outsider', key, { outcome: 'maybe', reason: 'x' })).status).toBe(400);
      expect(
        (await settle('outsider', 'not-a-key', { outcome: 'not_published', reason: 'x' })).status,
      ).toBe(404);
      const done = await approvedPublication('A key that is done is not stuck.');
      expect(
        (await settle('outsider', done.key, { outcome: 'not_published', reason: 'x' })).status,
      ).toBe(404);
    });

    it("another company's person cannot see or settle the key (404), and nothing changes", async () => {
      const { publication, key } = await approvedPublication('Attack on a settle.');
      await timeout(publication.id, key);
      const attempts = [
        { outcome: 'published', engineOperationId: publication.engineOperationId, reason: 'Mine.' },
        { outcome: 'not_published', reason: 'Mine.' },
      ];

      for (const attempt of attempts) {
        expect((await settle('creatorB', key, attempt)).status).toBe(404);
        // Different group entirely.
        expect([403, 404]).toContain((await settle('otherGroupAdmin', key, attempt)).status);
      }

      expect(
        (await query(`select state from idempotency_keys where key = $1`, [key]))[0].state,
      ).toBe('unknown');
      expect(
        (await query(`select status from publications where id = $1`, [publication.id]))[0].status,
      ).toBe('pending');
    });

    it('needs content.publish: a person who can only write or audit is refused', async () => {
      const { publication, key } = await approvedPublication('No permission to settle.');
      await timeout(publication.id, key);
      // adminA acts as company_admin and content_creator: neither holds content.publish.
      expect((await settle('adminA', key, { outcome: 'not_published', reason: 'x' })).status).toBe(
        403,
      );
      expect(
        (await send('POST', `/api/publications/stuck-keys/${key}/settle`, 'adminA', {})).status,
      ).toBe(403);
    });
  });
});

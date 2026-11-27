import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FakeEngine } from '@dcc/engine-client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OPERATIONAL_ENGINE } from '../src/modules/publishing/operational-engine.provider';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

/**
 * Owner decision 2026-11-27: a publishing freeze also holds the posts that were already scheduled. The engine sends a
 * scheduled post at its time on its own, so freezing cancels every scheduled post of the frozen company (or account) in
 * the engine, says why on the post, audits it, and leaves other companies and other accounts alone.
 */
describe('a freeze holds scheduled posts', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let fake: FakeEngine;
  let accountA2: string;
  const cookies = new Map<string, string>();
  const query = async (text: string, values: unknown[] = []) => {
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    try {
      return (await owner.query(text, values)).rows as Record<string, any>[];
    } finally {
      await owner.end();
    }
  };

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const grant = (userId: string, companyId: string, role: string) =>
      owner.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`,
        [userId, f.groupId, companyId, role],
      );
    const brand = (
      await owner.query(`select brand_id from social_accounts where id = $1`, [f.accountA])
    ).rows[0].brand_id;
    accountA2 = (
      await owner.query(
        `insert into social_accounts (company_id, brand_id, platform, display_name, handle) values ($1, $2, 'linkedin', 'A second page', '@a2') returning id`,
        [f.companyA, brand],
      )
    ).rows[0].id;
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-1' where id = $1`,
      [f.accountA],
    );
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-2' where id = $1`,
      [accountA2],
    );
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-facebook-1' where id = $1`,
      [f.accountB],
    );
    await grant(f.users.adminA, f.companyA, 'content_creator');
    await grant(f.users.auditorA, f.companyA, 'company_marketing_manager');
    await grant(f.users.outsider, f.companyA, 'company_executive');
    await grant(f.users.creatorB, f.companyB, 'company_marketing_manager');
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

  /** A post written by A's creator, approved by A's manager, scheduled by A's executive (who may publish). */
  const scheduledPost = async (text: string, accountId: string) => {
    const item = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: text,
        targetAccountIds: [accountId],
      }),
    );
    const request = await json(
      await send('POST', `/api/content-items/${item.id}/submit`, 'adminA'),
    );
    await send('POST', `/api/approval-requests/${request.id}/approve`, 'auditorA', {});
    const publish = () =>
      send('POST', `/api/content-items/${item.id}/publish`, 'outsider', {
        socialAccountId: accountId,
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      });
    const publication = await json(await publish());
    expect(publication.status).toBe('scheduled');
    expect(fake.posts.has(publication.engineOperationId)).toBe(true);
    return { item, publish, publication };
  };
  const status = async (id: string) =>
    (await query(`select status, error from publications where id = $1`, [id]))[0]!;

  it('freezing one account cancels only that account’s scheduled posts, in the engine, with the reason on the post', async () => {
    const onOne = await scheduledPost('Scheduled on the first page.', f.accountA);
    const onTwo = await scheduledPost('Scheduled on the second page.', accountA2);

    const frozen = await send('POST', '/api/publishing-freezes', 'outsider', {
      companyId: f.companyA,
      socialAccountId: f.accountA,
      reason: 'Wrong price in the posts',
    });
    expect(frozen.status).toBe(201);
    const body = await json(frozen);
    expect(body).toMatchObject({ scheduledCancelled: 1, scheduledNotCancelled: 0 });

    expect(fake.posts.has(onOne.publication.engineOperationId)).toBe(false);
    expect(await status(onOne.publication.id)).toMatchObject({ status: 'cancelled' });
    expect((await status(onOne.publication.id)).error).toContain('Wrong price in the posts');
    // the other account of the same company is untouched
    expect(fake.posts.has(onTwo.publication.engineOperationId)).toBe(true);
    expect(await status(onTwo.publication.id)).toMatchObject({ status: 'scheduled' });

    const audit = await query(
      `select details from audit_events where action = 'publication.cancelled' and target_id = $1`,
      [onOne.publication.id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ reason: 'publishing_freeze', freezeId: body.id });

    // the creator-side people who may publish are told, once, in plain words
    const told = await query(
      `select summary from notifications where target_id = $1 and summary like '%cancelled%'`,
      [body.id],
    );
    expect(told.length).toBeGreaterThan(0);

    // while frozen it cannot be scheduled again; after the lift a person can, with the same approved version
    expect((await onOne.publish()).status).toBe(403);
    expect((await send('DELETE', `/api/publishing-freezes/${body.id}`, 'outsider')).status).toBe(
      204,
    );
    const again = await onOne.publish();
    expect(again.status).toBe(201);
    expect((await json(again)).status).toBe('scheduled');
  });

  it('freezing the whole company cancels every scheduled post of that company and none of another company', async () => {
    const remaining = await query(
      `select id from publications where company_id = $1 and status = 'scheduled'`,
      [f.companyA],
    );
    expect(remaining.length).toBeGreaterThan(0);
    // company B has its own scheduled post
    const itemB = await json(
      await send('POST', '/api/content-items', 'creatorB', {
        companyId: f.companyB,
        body: 'Company B post.',
        targetAccountIds: [f.accountB],
      }),
    );
    expect(itemB.id).toBeTruthy();
    await query(
      `insert into publications (company_id, content_item_id, content_version_id, social_account_id, requested_by, approved_by, engine_operation_id, status, scheduled_at, idempotency_key)
       select $1, $2, ci.current_version_id, $3, $4, $4, 'engine-b-1', 'scheduled', now() + interval '2 days', $5
       from content_items ci where ci.id = $2`,
      [f.companyB, itemB.id, f.accountB, f.users.creatorB, `${itemB.id}:1:fake-facebook-1`],
    );

    const frozen = await send('POST', '/api/publishing-freezes', 'outsider', {
      companyId: f.companyA,
    });
    expect(frozen.status).toBe(201);
    expect((await json(frozen)).scheduledCancelled).toBe(remaining.length);
    expect(
      await query(`select id from publications where company_id = $1 and status = 'scheduled'`, [
        f.companyA,
      ]),
    ).toHaveLength(0);
    expect(
      await query(`select id from publications where company_id = $1 and status = 'scheduled'`, [
        f.companyB,
      ]),
    ).toHaveLength(1);
  });

  it('an engine that will not cancel leaves the post scheduled, says so in the answer and the audit trail', async () => {
    await query(`delete from publishing_freezes`);
    const stubborn = await scheduledPost('The engine will refuse to cancel this.', f.accountA);
    const original = fake.deletePost.bind(fake);
    fake.deletePost = async () => {
      throw new Error('engine unavailable');
    };
    try {
      const frozen = await send('POST', '/api/publishing-freezes', 'outsider', {
        companyId: f.companyA,
      });
      expect(frozen.status).toBe(201);
      expect(await json(frozen)).toMatchObject({ scheduledCancelled: 0, scheduledNotCancelled: 1 });
    } finally {
      fake.deletePost = original;
    }
    expect(await status(stubborn.publication.id)).toMatchObject({ status: 'scheduled' });
    expect(
      await query(
        `select id from audit_events where action = 'publication.freeze_cancel_failed' and target_id = $1`,
        [stubborn.publication.id],
      ),
    ).toHaveLength(1);
  });

  it('a freeze with nothing scheduled reports zero and a second freeze of the same scope is still refused', async () => {
    await query(`delete from publishing_freezes`);
    await query(
      `update publications set status = 'cancelled', completed_at = now() where status = 'scheduled'`,
    );
    const frozen = await send('POST', '/api/publishing-freezes', 'outsider', {
      companyId: f.companyA,
    });
    expect(await json(frozen)).toMatchObject({ scheduledCancelled: 0, scheduledNotCancelled: 0 });
    expect(
      (await send('POST', '/api/publishing-freezes', 'outsider', { companyId: f.companyA })).status,
    ).toBe(409);
  });
});

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
 * The unified inbox (read and reply through the engine) and scheduled publishing.
 *   - adminA:   company_admin + content_creator   reads the inbox, cannot reply; writes content
 *   - auditorA: + company_marketing_manager       reads, replies, approves
 *   - outsider: company_executive in company A    publishes
 *   - creatorB: + company_marketing_manager in B  the other company
 */
describe('inbox and scheduling', () => {
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
    const grant = (userId: string, companyId: string, role: string) =>
      owner.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`,
        [userId, f.groupId, companyId, role],
      );
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-1' where id = $1`,
      [f.accountA],
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
    const message = (id: string, channel: string, text: string) => ({
      engineMessageId: id,
      engineChannelId: channel,
      kind: 'comment' as const,
      authorName: 'A customer',
      text,
      receivedAt: new Date(Date.now() - 60_000),
      engineOperationId: null,
      replied: false,
    });
    fake.inboxMessages.push(
      message('msg-a', 'fake-linkedin-1', 'Where can I buy this?'),
      message('msg-b', 'fake-facebook-1', 'A question for company B.'),
    );
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

  describe('inbox', () => {
    it('shows each person only the messages of the companies they work for', async () => {
      const a = await json(await send('GET', '/api/inbox', 'auditorA'));
      expect(a.map((m: { engineMessageId: string }) => m.engineMessageId)).toEqual(['msg-a']);
      expect(a[0]).toMatchObject({ socialAccountId: f.accountA, companyId: f.companyA });
      const b = await json(await send('GET', '/api/inbox', 'creatorB'));
      expect(b.map((m: { engineMessageId: string }) => m.engineMessageId)).toEqual(['msg-b']);
      // asking for another company by id returns nothing, not an error that confirms it exists
      expect(
        await json(await send('GET', `/api/inbox?companyId=${f.companyB}`, 'auditorA')),
      ).toEqual([]);
    });

    it('a reply needs the permission, the right company and a message of that account; it is audited', async () => {
      const reply = (who: string, socialAccountId: string, engineMessageId: string) =>
        send('POST', '/api/inbox/reply', who, {
          socialAccountId,
          engineMessageId,
          text: 'Thank you. Our shops are listed on the website.',
        });
      // company_admin reads but does not answer
      expect((await reply('adminA', f.accountA, 'msg-a')).status).toBe(403);
      // another company's account
      expect((await reply('auditorA', f.accountB, 'msg-b')).status).toBe(404);
      // own account, but a message that belongs to another company's channel
      expect((await reply('auditorA', f.accountA, 'msg-b')).status).toBe(404);
      expect(fake.replies).toHaveLength(0);

      expect((await reply('auditorA', f.accountA, 'msg-a')).status).toBe(201);
      expect(fake.replies).toEqual([
        { engineMessageId: 'msg-a', text: 'Thank you. Our shops are listed on the website.' },
      ]);

      const owner = new pg.Client({ connectionString: ownerUrl() });
      await owner.connect();
      const events = await owner.query(
        `select action from audit_events where action like 'inbox.%' order by id`,
      );
      await owner.end();
      expect(events.rows.map((e) => e.action)).toEqual([
        'inbox.reply_requested',
        'inbox.reply_sent',
      ]);
    });

    it('a frozen company sends no replies', async () => {
      const frozen = await json(
        await send('POST', '/api/publishing-freezes', 'outsider', { companyId: f.companyA }),
      );
      const res = await send('POST', '/api/inbox/reply', 'auditorA', {
        socialAccountId: f.accountA,
        engineMessageId: 'msg-a',
        text: 'Again.',
      });
      expect(res.status).toBe(403);
      expect(fake.replies).toHaveLength(1);
      await send('DELETE', `/api/publishing-freezes/${frozen.id}`, 'outsider');
    });
  });

  describe('scheduling', () => {
    it('an approved post is scheduled for later, appears in the calendar window, and a past time is refused', async () => {
      const item = await json(
        await send('POST', '/api/content-items', 'adminA', {
          companyId: f.companyA,
          body: 'Goes out next week.',
          targetAccountIds: [f.accountA],
        }),
      );
      const request = await json(
        await send('POST', `/api/content-items/${item.id}/submit`, 'adminA'),
      );
      await send('POST', `/api/approval-requests/${request.id}/approve`, 'auditorA', {});

      const publish = (scheduledAt: string) =>
        send('POST', `/api/content-items/${item.id}/publish`, 'outsider', {
          socialAccountId: f.accountA,
          scheduledAt,
        });
      expect((await publish(new Date(Date.now() - 60_000).toISOString())).status).toBe(400);

      const when = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const res = await publish(when.toISOString());
      expect(res.status).toBe(201);
      const publication = await json(res);
      expect(publication).toMatchObject({
        status: 'scheduled',
        scheduledAt: when.toISOString(),
        completedAt: null,
      });
      // the item is not "published" until it really went out
      expect(
        (await json(await send('GET', `/api/content-items/${item.id}`, 'adminA'))).status,
      ).not.toBe('published');

      const day = 24 * 60 * 60 * 1000;
      const window = (fromDays: number, toDays: number) =>
        `/api/publications?from=${encodeURIComponent(new Date(Date.now() + fromDays * day).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + toDays * day).toISOString())}`;
      const inWindow = await json(await send('GET', window(6, 8), 'adminA'));
      expect(inWindow.map((p: { id: string }) => p.id)).toEqual([publication.id]);
      expect(await json(await send('GET', window(1, 2), 'adminA'))).toEqual([]);
      // company B sees none of it
      expect(await json(await send('GET', window(6, 8), 'creatorB'))).toEqual([]);
    });
  });
});

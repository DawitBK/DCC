import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FakeEngine, InboxMessage } from '@dcc/engine-client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OPERATIONAL_ENGINE } from '../src/modules/publishing/operational-engine.provider';
import { SessionService } from '../src/platform/auth/session.service';
import { createDatabase, type Database } from '../src/platform/database/database';
import { TenantDb } from '../src/platform/tenancy/tenant-db';
import {
  appUrl,
  ctx,
  listenForTests,
  ownerUrl,
  resetTestDatabase,
  seedFixture,
  type Fixture,
} from './helpers';

const ORIGIN = 'http://localhost:7717';
const MINUTE = 60_000;

/**
 * H-14: inbox assignment, a per-company response-time target (no default) and first-response tracking.
 *   - adminA:   company_admin + content_creator   reads the inbox and manages company A's settings; cannot reply
 *   - auditorA: company_marketing_manager A       reads and replies
 *   - outsider: company_executive A               reads and replies (a second assignee)
 *   - creatorB: company_marketing_manager B + company_admin B   the other company
 */
describe('inbox assignment and response times (H-14)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let fake: FakeEngine;
  let database: Database;
  const cookies = new Map<string, string>();

  const message = (
    id: string,
    channel: string,
    minutesAgo: number,
    replied = false,
  ): InboxMessage => ({
    engineMessageId: id,
    engineChannelId: channel,
    kind: 'comment',
    authorName: 'A customer',
    text: `Text of ${id}`,
    receivedAt: new Date(Date.now() - minutesAgo * MINUTE),
    engineOperationId: null,
    replied,
  });

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
    await grant(f.users.creatorB, f.companyB, 'company_admin');
    await owner.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    base = await listenForTests(app);
    fake = app.get(OPERATIONAL_ENGINE);
    fake.inboxMessages.push(
      message('msg-a', 'fake-linkedin-1', 1),
      message('msg-b', 'fake-facebook-1', 1),
    );
    const sessions = app.get(SessionService);
    for (const [name, id] of Object.entries(f.users)) {
      cookies.set(name, `dcc_sid=${(await sessions.create({ userId: id })).id}`);
    }
    database = createDatabase(appUrl(), 1);
  });
  afterAll(async () => {
    await database.close();
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
  const listFor = async (who: string, qs = '') => json(await send('GET', `/api/inbox${qs}`, who));
  const find = (list: any[], id: string) => list.find((m) => m.engineMessageId === id);
  // The practice engine adds its own sample messages (practice-message-N): these tests look at their own only.
  const ownIds = (list: any[]) =>
    list.map((m) => m.engineMessageId as string).filter((id) => id.startsWith('msg-'));
  const assign = (
    who: string,
    engineMessageId: string,
    assigneeUserId: string | null,
    account = f.accountA,
  ) =>
    send('PUT', '/api/inbox/assignment', who, {
      socialAccountId: account,
      engineMessageId,
      assigneeUserId,
    });
  const setTarget = (who: string, companyId: string, responseTargetMinutes: number | null) =>
    send('PUT', '/api/inbox/settings', who, { companyId, responseTargetMinutes });
  const auditActions = async (like: string) =>
    (await query(`select action from audit_events where action like $1 order by id`, [like])).map(
      (r) => r.action as string,
    );

  describe('assignees', () => {
    it('lists the people who may reply for the company, and no one else', async () => {
      const list = await json(
        await send('GET', `/api/inbox/assignees?companyId=${f.companyA}`, 'auditorA'),
      );
      expect(list.map((p: any) => p.userId).sort()).toEqual(
        [f.users.auditorA, f.users.outsider].sort(),
      );
      expect(list[0]).toEqual({ userId: expect.any(String), displayName: expect.any(String) });
    });

    it("another company's person, a person who cannot reply and a stranger get nothing", async () => {
      const path = `/api/inbox/assignees?companyId=${f.companyA}`;
      expect((await send('GET', path, 'creatorB')).status).toBe(404);
      expect((await send('GET', path, 'adminA')).status).toBe(403); // reads the inbox, cannot reply
      expect((await send('GET', path, 'otherGroupAdmin')).status).toBe(403);
      expect(
        (await send('GET', `/api/inbox/assignees?companyId=${f.company2}`, 'auditorA')).status,
      ).toBe(404);
      expect((await send('GET', '/api/inbox/assignees', 'auditorA')).status).toBe(400);
    });
  });

  describe('assignment', () => {
    it('assigns a message, shows it in the list with the filters, and audits it', async () => {
      const response = await assign('auditorA', 'msg-a', f.users.outsider);
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        socialAccountId: f.accountA,
        engineMessageId: 'msg-a',
        assignedTo: f.users.outsider,
        assignedToName: 'sub-outsider',
        assignedAt: expect.any(String),
      });

      const list = await listFor('auditorA');
      expect(find(list, 'msg-a')).toMatchObject({
        assignedTo: f.users.outsider,
        assignedToName: 'sub-outsider',
        assignedAt: expect.any(String),
      });
      const mine = await listFor('auditorA', `?assignedTo=${f.users.outsider}`);
      expect(mine.map((m: any) => m.engineMessageId)).toEqual(['msg-a']);
      const assigned = await listFor('auditorA', '?unassigned=false');
      expect(assigned.map((m: any) => m.engineMessageId)).toEqual(['msg-a']);
      const nobody = await listFor('auditorA', '?unassigned=true');
      expect(nobody.map((m: any) => m.engineMessageId)).not.toContain('msg-a');
      expect(await auditActions('inbox.assign%')).toEqual(['inbox.assigned']);
      const audit = (
        await query(
          `select actor_user_id, details from audit_events where action = 'inbox.assigned'`,
        )
      )[0];
      expect(audit.actor_user_id).toBe(f.users.auditorA);
      expect(audit.details).toMatchObject({
        engineMessageId: 'msg-a',
        assignedTo: f.users.outsider,
        previouslyAssignedTo: null,
      });
    });

    it('assigning the same person again changes and audits nothing; reassigning and clearing are audited', async () => {
      expect((await assign('auditorA', 'msg-a', f.users.outsider)).status).toBe(200);
      expect(await auditActions('inbox.%assigned')).toEqual(['inbox.assigned']);

      expect((await assign('outsider', 'msg-a', f.users.auditorA)).status).toBe(200);
      expect(find(await listFor('auditorA'), 'msg-a').assignedTo).toBe(f.users.auditorA);

      const cleared = await assign('auditorA', 'msg-a', null);
      expect(cleared.status).toBe(200);
      expect(await json(cleared)).toMatchObject({
        assignedTo: null,
        assignedToName: null,
        assignedAt: null,
      });
      expect(find(await listFor('auditorA'), 'msg-a')).toMatchObject({
        assignedTo: null,
        assignedAt: null,
      });
      expect(await auditActions('inbox.%assigned')).toEqual([
        'inbox.assigned',
        'inbox.assigned',
        'inbox.unassigned',
      ]);
      // Clearing a message nobody holds is a no-op too.
      expect((await assign('auditorA', 'msg-a', null)).status).toBe(200);
      expect(await auditActions('inbox.%assigned')).toHaveLength(3);
    });

    it('refuses an assignee who cannot reply for the company, in any other company or unknown', async () => {
      expect((await assign('auditorA', 'msg-a', f.users.adminA)).status).toBe(400); // reads only
      expect((await assign('auditorA', 'msg-a', f.users.creatorB)).status).toBe(400); // other company
      expect((await assign('auditorA', 'msg-a', f.users.otherGroupAdmin)).status).toBe(400);
      expect(
        (await assign('auditorA', 'msg-a', '00000000-0000-4000-8000-000000000000')).status,
      ).toBe(400);
      expect(find(await listFor('auditorA'), 'msg-a').assignedTo).toBeNull();
    });

    it("refuses another company's person, a person who cannot reply, and a message that is not on the account", async () => {
      // adminA reads the inbox but may not reply, so may not assign.
      expect((await assign('adminA', 'msg-a', f.users.auditorA)).status).toBe(403);
      // creatorB works for company B: company A's account does not exist for them.
      expect((await assign('creatorB', 'msg-a', f.users.creatorB)).status).toBe(404);
      expect((await assign('otherGroupAdmin', 'msg-a', null)).status).toBe(403);
      // A's person on B's account.
      expect((await assign('auditorA', 'msg-b', f.users.auditorA, f.accountB)).status).toBe(404);
      // A message of B's channel named on A's account.
      expect((await assign('auditorA', 'msg-b', f.users.auditorA)).status).toBe(404);
      expect((await assign('auditorA', 'no-such-message', f.users.auditorA)).status).toBe(404);
      // Bad bodies.
      expect(
        (await send('PUT', '/api/inbox/assignment', 'auditorA', { engineMessageId: 'msg-a' }))
          .status,
      ).toBe(400);
      expect(
        (
          await send('PUT', '/api/inbox/assignment', 'auditorA', {
            socialAccountId: f.accountA,
            engineMessageId: 'msg-a',
            assigneeUserId: 'not-a-uuid',
          })
        ).status,
      ).toBe(400);
      expect(await query(`select count(*)::int as n from inbox_items`)).toEqual([{ n: 1 }]);
    });

    it("the database keeps one company's assignments from another company's person", async () => {
      await assign('auditorA', 'msg-a', f.users.outsider);
      const tenant = new TenantDb(database);
      const asB = ctx(f.users.creatorB, [], [f.companyB]);
      const asA = ctx(f.users.auditorA, [], [f.companyA]);
      expect(
        await tenant.run(asB, (trx) => trx.selectFrom('inbox_items').selectAll().execute()),
      ).toEqual([]);
      expect(
        (await tenant.run(asA, (trx) => trx.selectFrom('inbox_items').selectAll().execute()))
          .length,
      ).toBe(1);
      // B's person cannot write a row for A's account, nor change A's row.
      await expect(
        tenant.run(asB, (trx) =>
          trx
            .insertInto('inbox_items')
            .values({
              company_id: f.companyA,
              social_account_id: f.accountA,
              engine_message_id: 'forged',
              received_at: new Date(),
            })
            .execute(),
        ),
      ).rejects.toThrow();
      const changed = await tenant.run(asB, (trx) =>
        trx
          .updateTable('inbox_items')
          .set({
            assigned_to: f.users.creatorB,
            assigned_by: f.users.creatorB,
            assigned_at: new Date(),
          })
          .returning('id')
          .execute(),
      );
      expect(changed).toEqual([]);
      expect(find(await listFor('auditorA'), 'msg-a').assignedTo).toBe(f.users.outsider);
      await assign('auditorA', 'msg-a', null);
    });
  });

  describe('response-time target', () => {
    it('has no default: every company starts with null and nothing is overdue', async () => {
      const settings = await json(await send('GET', '/api/inbox/settings', 'auditorA'));
      expect(settings).toEqual([
        { companyId: f.companyA, responseTargetMinutes: null, updatedAt: null },
      ]);
      fake.inboxMessages.push(message('msg-ancient', 'fake-linkedin-1', 60 * 24 * 20));
      const list = await listFor('auditorA');
      const old = find(list, 'msg-ancient');
      expect(old).toMatchObject({ dueAt: null, overdue: false, responseSeconds: null });
      expect(list.every((m: any) => m.overdue === false)).toBe(true);
    });

    it('is managed by whoever manages the company, nobody else, and is audited', async () => {
      // The people who work the inbox cannot change their own target.
      expect((await setTarget('auditorA', f.companyA, 15)).status).toBe(403);
      expect((await setTarget('outsider', f.companyA, 15)).status).toBe(403);
      // Another company's administrator, and another group's, cannot change company A's.
      expect([403, 404]).toContain((await setTarget('creatorB', f.companyA, 15)).status);
      expect([403, 404]).toContain((await setTarget('otherGroupAdmin', f.companyA, 15)).status);
      expect(await query(`select 1 from inbox_settings`)).toHaveLength(0);

      const response = await setTarget('adminA', f.companyA, 15);
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        companyId: f.companyA,
        responseTargetMinutes: 15,
        updatedAt: expect.any(String),
      });
      expect(await auditActions('inbox.response_target_set')).toHaveLength(1);
      const audit = (
        await query(
          `select actor_user_id, details from audit_events where action = 'inbox.response_target_set'`,
        )
      )[0];
      expect(audit.actor_user_id).toBe(f.users.adminA);
      expect(audit.details).toEqual({ previousMinutes: null, minutes: 15 });
      // Same value again: nothing changes, nothing is audited.
      expect((await setTarget('adminA', f.companyA, 15)).status).toBe(200);
      expect(await auditActions('inbox.response_target_set')).toHaveLength(1);
      // Company B was not touched.
      expect((await json(await send('GET', '/api/inbox/settings', 'creatorB')))[0]).toMatchObject({
        companyId: f.companyB,
        responseTargetMinutes: null,
      });
      expect((await json(await send('GET', '/api/inbox/settings', 'auditorA')))[0]).toMatchObject({
        companyId: f.companyA,
        responseTargetMinutes: 15,
      });
    });

    it('validates the number and clears with null', async () => {
      for (const bad of [0, -5, 1.5, 43_201, '15', undefined]) {
        expect((await setTarget('adminA', f.companyA, bad as never)).status, String(bad)).toBe(400);
      }
      expect(
        (await send('PUT', '/api/inbox/settings', 'adminA', { responseTargetMinutes: 5 })).status,
      ).toBe(400);
      expect((await setTarget('adminA', '00000000-0000-4000-8000-000000000000', 5)).status).toBe(
        404,
      );
      const cleared = await setTarget('adminA', f.companyA, null);
      expect(cleared.status).toBe(200);
      expect(await json(cleared)).toMatchObject({ responseTargetMinutes: null });
      const audit = await query(
        `select details from audit_events where action = 'inbox.response_target_set' order by id desc limit 1`,
      );
      expect(audit[0].details).toEqual({ previousMinutes: 15, minutes: null });
      await setTarget('adminA', f.companyA, 10);
    });
  });

  describe('first response and overdue', () => {
    it('computes due time and overdue against the target, and keeps the first reply time', async () => {
      // target of company A is 10 minutes (set above); company B has none.
      fake.inboxMessages.push(
        message('msg-late', 'fake-linkedin-1', 30),
        message('msg-fresh', 'fake-linkedin-1', 1),
        message('msg-outside', 'fake-linkedin-1', 120, true),
        message('msg-b-old', 'fake-facebook-1', 500),
      );

      const list = await listFor('auditorA');
      expect(find(list, 'msg-late')).toMatchObject({
        overdue: true,
        replied: false,
        firstResponseAt: null,
      });
      expect(find(list, 'msg-fresh')).toMatchObject({ overdue: false, replied: false });
      expect(
        new Date(find(list, 'msg-fresh').dueAt).getTime() -
          new Date(find(list, 'msg-fresh').receivedAt).getTime(),
      ).toBe(10 * MINUTE);
      // Answered outside DCC: DCC does not know when, so it does not call it late.
      expect(find(list, 'msg-outside')).toMatchObject({
        replied: true,
        overdue: false,
        firstResponseAt: null,
        responseSeconds: null,
      });
      // Overdue filter.
      const overdue = await listFor('auditorA', '?overdue=true');
      expect(ownIds(overdue).sort()).toEqual(['msg-ancient', 'msg-late'].sort());
      expect(
        (await listFor('auditorA', '?overdue=false')).map((m: any) => m.engineMessageId),
      ).not.toContain('msg-late');
      // Company B has no target: its old message is not overdue.
      expect(find(await listFor('creatorB'), 'msg-b-old')).toMatchObject({
        dueAt: null,
        overdue: false,
      });

      // A late reply through DCC records the time it took; it stays overdue although it is answered now.
      const reply = (id: string) =>
        send('POST', '/api/inbox/reply', 'auditorA', {
          socialAccountId: f.accountA,
          engineMessageId: id,
          text: 'Thank you for writing to us.',
        });
      expect((await reply('msg-late')).status).toBe(201);
      expect((await reply('msg-fresh')).status).toBe(201);
      const after = await listFor('auditorA');
      const late = find(after, 'msg-late');
      expect(late).toMatchObject({
        replied: true,
        overdue: true,
        firstResponseAt: expect.any(String),
      });
      expect(late.responseSeconds).toBeGreaterThanOrEqual(30 * 60);
      expect(late.responseSeconds).toBeLessThan(31 * 60);
      const fresh = find(after, 'msg-fresh');
      expect(fresh).toMatchObject({ replied: true, overdue: false });
      expect(fresh.responseSeconds).toBeGreaterThanOrEqual(60);
      expect(fresh.responseSeconds).toBeLessThan(5 * 60);

      // A second reply does not move the first-response time.
      const before = (
        await query(
          `select first_response_at, first_response_by from inbox_items where engine_message_id = 'msg-late'`,
        )
      )[0];
      expect(before.first_response_by).toBe(f.users.auditorA);
      expect((await reply('msg-late')).status).toBe(201);
      const unchanged = (
        await query(
          `select first_response_at from inbox_items where engine_message_id = 'msg-late'`,
        )
      )[0];
      expect(unchanged.first_response_at.getTime()).toBe(before.first_response_at.getTime());
    });

    it('a changed target applies to existing messages, and clearing it ends every overdue flag', async () => {
      expect((await setTarget('adminA', f.companyA, 24 * 60)).status).toBe(200);
      expect(ownIds(await listFor('auditorA', '?overdue=true'))).toEqual(['msg-ancient']);
      expect((await setTarget('adminA', f.companyA, null)).status).toBe(200);
      expect((await listFor('auditorA', '?overdue=true')).length).toBe(0);
      await setTarget('adminA', f.companyA, 10);
    });

    it('a reply through DCC to a message that was assigned keeps the assignment, and another company sees none of it', async () => {
      fake.inboxMessages.push(message('msg-assigned', 'fake-linkedin-1', 2));
      expect((await assign('auditorA', 'msg-assigned', f.users.outsider)).status).toBe(200);
      expect(
        (
          await send('POST', '/api/inbox/reply', 'outsider', {
            socialAccountId: f.accountA,
            engineMessageId: 'msg-assigned',
            text: 'Answered by the assignee.',
          })
        ).status,
      ).toBe(201);
      const row = find(await listFor('auditorA'), 'msg-assigned');
      expect(row).toMatchObject({
        assignedTo: f.users.outsider,
        replied: true,
        firstResponseAt: expect.any(String),
      });
      const b = await listFor('creatorB');
      expect(b.every((m: any) => m.companyId === f.companyB)).toBe(true);
      expect(find(b, 'msg-assigned')).toBeUndefined();
      expect(
        (await send('GET', '/api/inbox?assignedTo=' + f.users.outsider, 'creatorB')).status,
      ).toBe(200);
      expect(await listFor('creatorB', `?assignedTo=${f.users.outsider}`)).toEqual([]);
    });
  });

  describe('assignment notifies the assignee', () => {
    const itemOf = async (id: string) =>
      (
        await query(
          `select id from inbox_items where social_account_id = $1 and engine_message_id = $2`,
          [f.accountA, id],
        )
      )[0]?.id as string | undefined;
    /** The "assigned to you" notifications about one message, as the person sees them through the API. */
    const assignedNotes = async (who: string, id: string) => {
      const item = await itemOf(id);
      const all = await json(await send('GET', '/api/notifications', who));
      return all.filter((n: any) => n.eventType === 'inbox.assigned' && n.targetId === item);
    };
    const allNoteRows = async () =>
      (
        await query(
          `select count(*)::int as n from notifications where event_type = 'inbox.assigned'`,
        )
      )[0].n as number;

    it('tells the new assignee, not the person who assigned, and carries no message text', async () => {
      fake.inboxMessages.push(message('msg-note-1', 'fake-linkedin-1', 3));
      const before = await allNoteRows();
      expect((await assign('auditorA', 'msg-note-1', f.users.outsider)).status).toBe(200);
      const mine = await assignedNotes('outsider', 'msg-note-1');
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        companyId: f.companyA,
        targetType: 'inbox_item',
        readAt: null,
        summary: expect.stringContaining('assigned to you'),
      });
      expect(JSON.stringify(mine[0])).not.toContain('Text of msg-note-1');
      expect(JSON.stringify(mine[0])).not.toContain('A customer');
      expect(await assignedNotes('auditorA', 'msg-note-1')).toEqual([]);
      expect(await allNoteRows()).toBe(before + 1);
    });

    it('a repeat of the same assignment and clearing notify nobody', async () => {
      const before = await allNoteRows();
      expect((await assign('auditorA', 'msg-note-1', f.users.outsider)).status).toBe(200);
      expect((await assign('outsider', 'msg-note-1', f.users.outsider)).status).toBe(200);
      expect(await allNoteRows()).toBe(before);
      expect((await assign('auditorA', 'msg-note-1', null)).status).toBe(200);
      expect(await allNoteRows()).toBe(before);
      expect(await assignedNotes('outsider', 'msg-note-1')).toHaveLength(1);
    });

    it('assigning a message to yourself notifies nobody', async () => {
      fake.inboxMessages.push(message('msg-note-2', 'fake-linkedin-1', 3));
      const before = await allNoteRows();
      expect((await assign('auditorA', 'msg-note-2', f.users.auditorA)).status).toBe(200);
      expect(await allNoteRows()).toBe(before);
      expect(await assignedNotes('auditorA', 'msg-note-2')).toEqual([]);
    });

    it('a reassignment tells the new person only, and a re-assignment back tells them again', async () => {
      const before = await allNoteRows();
      expect((await assign('outsider', 'msg-note-2', f.users.auditorA)).status).toBe(200); // self -> same: no-op
      expect(await allNoteRows()).toBe(before);
      expect((await assign('auditorA', 'msg-note-2', f.users.outsider)).status).toBe(200);
      expect(await assignedNotes('outsider', 'msg-note-2')).toHaveLength(1);
      expect((await assign('outsider', 'msg-note-2', f.users.auditorA)).status).toBe(200);
      expect(await assignedNotes('auditorA', 'msg-note-2')).toHaveLength(1);
      expect(await assignedNotes('outsider', 'msg-note-2')).toHaveLength(1);
    });

    it("a refused assignment writes no notification, and nobody else sees the assignee's notification", async () => {
      fake.inboxMessages.push(message('msg-note-3', 'fake-linkedin-1', 3));
      const before = await allNoteRows();
      expect((await assign('auditorA', 'msg-note-3', f.users.creatorB)).status).toBe(400); // other company
      expect((await assign('auditorA', 'msg-note-3', f.users.adminA)).status).toBe(400); // cannot reply
      expect((await assign('adminA', 'msg-note-3', f.users.auditorA)).status).toBe(403); // cannot assign
      expect((await assign('creatorB', 'msg-note-3', f.users.creatorB)).status).toBe(404); // not their account
      expect(await allNoteRows()).toBe(before);
      // The notification of msg-note-1 is personal: nobody else (own company or another) reads it.
      const item = await itemOf('msg-note-1');
      for (const who of ['auditorA', 'adminA', 'creatorB', 'otherGroupAdmin', 'groupAdmin']) {
        const all = await json(await send('GET', '/api/notifications', who));
        expect(
          all.some((n: any) => n.targetId === item),
          who,
        ).toBe(false);
      }
      // The database agrees: the row exists for the assignee only, and company B cannot write one for A.
      const tenant = new TenantDb(database);
      const asB = ctx(f.users.creatorB, [], [f.companyB]);
      await expect(
        tenant.run(asB, (trx) =>
          trx
            .insertInto('notifications')
            .values({
              company_id: f.companyA,
              recipient_user_id: f.users.outsider,
              event_type: 'inbox.assigned',
              target_type: 'inbox_item',
              target_id: item!,
              summary: 'forged',
            })
            .execute(),
        ),
      ).rejects.toThrow();
    });

    it('the assignment still succeeds and is audited exactly once per change', async () => {
      const rows = await query(
        `select count(*)::int as n from audit_events where action = 'inbox.assigned' and details->>'engineMessageId' = 'msg-note-2'`,
      );
      expect(rows[0].n).toBe(3); // auditorA (self), outsider, auditorA again
    });
  });
});

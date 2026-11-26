import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FakeEngine, InboxMessage } from '@dcc/engine-client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OPERATIONAL_ENGINE } from '../src/modules/publishing/operational-engine.provider';
import { SweepService } from '../src/modules/working-hours/sweep.service';
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
const DAY = 24 * 60 * MINUTE;

/**
 * Round 2, inbox clock (H-19, RQ-031, RQ-023): priority, working-hours targets, reassignment rules, the escalation
 * ladder in the sweep and in the list, the monthly count of misses, and the walls between companies.
 *
 * Every date is relative to `BASE`, a Tuesday 08:30 local (05:30 UTC) between 14 and 21 days ago, so the real clock
 * (used by the engine lookups of assign and priority) always sees these messages as past, and the sweep is given the
 * `now` it needs. The default calendar is Monday to Saturday 08:30 to 17:30, UTC+3.
 *
 *   managerA  company_marketing_manager A   (the Digital Marketing Manager: reads, replies, manages settings)
 *   writerA, writer2A  content_creator A    (Content Writers: reply, set priority, never settings)
 *   execA     company_executive A           (Marketing & Communications Manager: told at 200%)
 *   gm        group_marketing (group level) (told at 200%, cannot reply)
 *   adminA    company_admin A               (manages settings, cannot reply)
 *   managerB, creatorB  company B           (the other company)
 *   managerC  the only person of company C  (nobody to hand a message to)
 */
describe('inbox clock: priority, working-hours targets and escalation (Round 2)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let fake: FakeEngine;
  let database: Database;
  let companyC: string;
  let accountC: string;
  const users: Record<string, string> = {};
  const cookies = new Map<string, string>();

  const today = Date.now();
  // The Tuesday 05:30 UTC at least 14 days back.
  const probe = new Date(today - 14 * DAY);
  probe.setUTCHours(5, 30, 0, 0);
  while (probe.getUTCDay() !== 2) probe.setUTCDate(probe.getUTCDate() - 1);
  const BASE = probe.getTime();
  /** `minutes` after the Tuesday 08:30 local start. */
  const at = (minutes: number) => new Date(BASE + minutes * MINUTE);
  const iso = (minutes: number) => at(minutes).toISOString();
  const day = (offsetDays: number) =>
    at(offsetDays * 24 * 60)
      .toISOString()
      .slice(0, 10);

  const message = (
    id: string,
    channel: string,
    receivedAt: Date,
    replied = false,
  ): InboxMessage => ({
    engineMessageId: id,
    engineChannelId: channel,
    kind: 'comment',
    authorName: 'A customer',
    text: `Text of ${id}`,
    receivedAt,
    engineOperationId: null,
    replied,
  });
  const put = (...m: InboxMessage[]) => fake.inboxMessages.push(...m);
  const clear = () => {
    fake.inboxMessages.length = 0;
  };

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const one = async (text: string, values: unknown[] = []) =>
      (await owner.query(text, values)).rows[0].id as string;
    const addUser = async (name: string, role: string, companyId: string | null) => {
      users[name] = await one(
        `insert into users (idp_subject, email, display_name) values ($1, $2, $1) returning id`,
        [`sub-${name}`, `${name}@example.test`],
      );
      await owner.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`,
        [users[name], f.groupId, companyId, role],
      );
    };
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-1' where id = $1`,
      [f.accountA],
    );
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-facebook-1' where id = $1`,
      [f.accountB],
    );
    companyC = await one(
      `insert into companies (group_id, name, slug) values ($1, 'Company C', 'c') returning id`,
      [f.groupId],
    );
    const brandC = await one(
      `insert into brands (company_id, name, slug) values ($1, 'Brand C', 'brand-c') returning id`,
      [companyC],
    );
    accountC = await one(
      `insert into social_accounts (company_id, brand_id, platform, display_name, handle, engine_channel_id)
       values ($1, $2, 'youtube', 'C channel', '@c', 'fake-youtube-1') returning id`,
      [companyC, brandC],
    );
    await addUser('managerA', 'company_marketing_manager', f.companyA);
    await addUser('writerA', 'content_creator', f.companyA);
    await addUser('writer2A', 'content_creator', f.companyA);
    await addUser('execA', 'company_executive', f.companyA);
    await addUser('gm', 'group_marketing', null);
    await addUser('managerB', 'company_marketing_manager', f.companyB);
    await addUser('managerC', 'company_marketing_manager', companyC);
    await owner.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    base = await listenForTests(app);
    fake = app.get(OPERATIONAL_ENGINE);
    clear(); // the practice engine's own sample messages are not part of these tests
    const sessions = app.get(SessionService);
    for (const [name, id] of [...Object.entries(f.users), ...Object.entries(users)]) {
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
  const uid = (name: string) => (users[name] ?? (f.users as Record<string, string>)[name])!;
  const WIDE = `from=${encodeURIComponent(new Date(BASE - DAY).toISOString())}&to=${encodeURIComponent(new Date(today).toISOString())}`;
  const listFor = async (who: string, extra = '') =>
    json(await send('GET', `/api/inbox?${WIDE}${extra}`, who));
  const find = (list: any[], id: string) => list.find((m) => m.engineMessageId === id);
  const assign = (who: string, id: string, to: string | null, account = f.accountA) =>
    send('PUT', '/api/inbox/assignment', who, {
      socialAccountId: account,
      engineMessageId: id,
      assigneeUserId: to === null ? null : uid(to),
    });
  const priority = (who: string, id: string, p: string, account = f.accountA) =>
    send('PUT', '/api/inbox/priority', who, {
      socialAccountId: account,
      engineMessageId: id,
      priority: p,
    });
  const settingsOf = async (who: string, companyId: string) =>
    (await json(await send('GET', '/api/inbox/settings', who))).find(
      (s: any) => s.companyId === companyId,
    );
  const sweepAt = async (minutes: number | Date) => {
    const failures = await app
      .get(SweepService)
      .runOnce(typeof minutes === 'number' ? at(minutes) : minutes);
    expect(failures).toEqual([]);
  };
  /** Wipes the work of earlier tests (rows only: the audit trail stays). */
  const resetWork = async () => {
    await query(`delete from escalation_events`);
    await query(`delete from notifications`);
    await query(`delete from inbox_items`);
    clear();
  };
  const notes = async (who: string, type = 'inbox.escalated') =>
    (await query(
      `select summary, target_id from notifications where recipient_user_id = $1 and event_type = $2 order by created_at, id`,
      [uid(who), type],
    )) as { summary: string; target_id: string }[];
  const events = async (messageId: string) =>
    (
      await query(
        `select e.level from escalation_events e join inbox_items i on i.id = e.target_id
        where e.kind = 'inbox' and i.engine_message_id = $1 order by e.level`,
        [messageId],
      )
    ).map((r) => r.level as number);
  const itemRow = async (messageId: string) =>
    (await query(`select * from inbox_items where engine_message_id = $1`, [messageId]))[0];
  const setHours = (who: string, companyId: string, holidays: string[] = []) =>
    send('PUT', '/api/working-hours', who, {
      companyId,
      workDays: [1, 2, 3, 4, 5, 6],
      startMinute: 510,
      endMinute: 1050,
      utcOffsetMinutes: 180,
      holidays,
    });

  describe('priority', () => {
    it('a Content Writer marks a message urgent: the due time follows, who set it is kept and audited', async () => {
      put(message('p-1', 'fake-linkedin-1', at(60))); // 09:30 local
      const r = await priority('writerA', 'p-1', 'urgent');
      expect(r.status).toBe(200);
      expect(await json(r)).toMatchObject({
        engineMessageId: 'p-1',
        priority: 'urgent',
        setBy: users.writerA,
        setByName: 'sub-writerA',
        setAt: expect.any(String),
        dueAt: iso(120), // 1 working hour after 09:30 local
      });
      const row = (await listFor('managerA')).find((m: any) => m.engineMessageId === 'p-1');
      expect(row).toMatchObject({
        priority: 'urgent',
        prioritySetBy: users.writerA,
        dueAt: iso(120),
        escalationLevel: expect.any(Number),
        needsManager: false,
        reassignmentCount: 0,
      });
      const audit = await query(
        `select actor_user_id, details from audit_events where action = 'inbox.priority_set' order by id`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].actor_user_id).toBe(users.writerA);
      expect(audit[0].details).toMatchObject({
        engineMessageId: 'p-1',
        from: 'normal',
        to: 'urgent',
      });
      // The same priority again changes and audits nothing.
      expect((await priority('writerA', 'p-1', 'urgent')).status).toBe(200);
      expect(
        await query(`select 1 from audit_events where action = 'inbox.priority_set'`),
      ).toHaveLength(1);
    });

    it('a message nobody marked is normal; low waits 24 working hours (1440 minutes, Tuesday to Thursday afternoon)', async () => {
      put(message('p-2', 'fake-linkedin-1', at(0)), message('p-3', 'fake-linkedin-1', at(0)));
      expect((await priority('managerA', 'p-3', 'low')).status).toBe(200);
      const list = await listFor('managerA');
      expect(find(list, 'p-2')).toMatchObject({ priority: 'normal', prioritySetBy: null });
      expect(find(list, 'p-2').dueAt).toBe(iso(240));
      // 1440 working minutes at 540 a day: Tuesday 540 + Wednesday 540 + 360 on Thursday = 14:30 local.
      expect(find(list, 'p-3')).toMatchObject({ priority: 'low', dueAt: iso(2 * 24 * 60 + 360) });
    });

    it('urgent counts working time by default and round the clock when the company says so', async () => {
      put(message('p-night', 'fake-linkedin-1', at(12 * 60 + 30))); // Tuesday 21:00 local
      expect((await priority('writerA', 'p-night', 'urgent')).status).toBe(200);
      // Working: the clock starts Wednesday 08:30 local (Tuesday 05:30 UTC + 24 h) and 60 minutes later.
      expect(find(await listFor('managerA'), 'p-night').dueAt).toBe(iso(24 * 60 + 60));
      expect(
        (
          await send('PUT', '/api/inbox/settings', 'managerA', {
            companyId: f.companyA,
            urgentRoundTheClock: true,
          })
        ).status,
      ).toBe(200);
      expect(find(await listFor('managerA'), 'p-night').dueAt).toBe(iso(12 * 60 + 30 + 60));
      // Normal is unaffected by the flag.
      expect(find(await listFor('managerA'), 'p-2').dueAt).toBe(iso(240));
      await send('PUT', '/api/inbox/settings', 'managerA', {
        companyId: f.companyA,
        urgentRoundTheClock: false,
      });
      expect(find(await listFor('managerA'), 'p-night').dueAt).toBe(iso(24 * 60 + 60));
    });

    it('is refused to a person who cannot reply, to another company, and for bad input', async () => {
      expect((await priority('auditorA', 'p-1', 'low')).status).toBe(403); // reads reports only
      expect((await priority('adminA', 'p-1', 'low')).status).toBe(403); // manages, cannot reply
      expect((await priority('gm', 'p-1', 'low')).status).toBe(403); // group level, reads only
      expect((await priority('creatorB', 'p-1', 'low')).status).toBe(404); // company B's writer, company A's account
      expect((await priority('otherGroupAdmin', 'p-1', 'low')).status).toBe(403);
      expect((await priority('writerA', 'no-such-message', 'low')).status).toBe(404);
      expect((await priority('writerA', 'p-1', 'critical')).status).toBe(400);
      expect(
        (await send('PUT', '/api/inbox/priority', 'writerA', { engineMessageId: 'p-1' })).status,
      ).toBe(400);
      // A message of company B's channel named on company A's account.
      put(message('p-b', 'fake-facebook-1', at(0)));
      expect((await priority('writerA', 'p-b', 'low')).status).toBe(404);
      expect(find(await listFor('managerA'), 'p-1').priority).toBe('urgent');
    });
  });

  describe('the clock counts working time (Monday to Saturday 08:30 to 17:30, UTC+3)', () => {
    const due = async (id: string, receivedAt: Date) => {
      clear();
      put(message(id, 'fake-linkedin-1', receivedAt));
      return find(await listFor('managerA'), id).dueAt as string;
    };

    it('a message at night starts counting the next morning', async () => {
      expect(await due('c-night', at(12 * 60 + 30))).toBe(iso(24 * 60 + 240)); // Tue 21:00 -> Wed 12:30 local
    });

    it('Saturday is a working day and Sunday is not', async () => {
      // Saturday 15:30 local: 2 hours left that day, 2 more on Monday 08:30.
      expect(await due('c-sat', at(4 * 24 * 60 + 7 * 60))).toBe(iso(6 * 24 * 60 + 120));
      // Sunday 12:00 local: starts Monday 08:30.
      expect(await due('c-sun', at(5 * 24 * 60 + 3 * 60 + 30))).toBe(iso(6 * 24 * 60 + 240));
    });

    it('a public holiday of the company does not count, and nobody else is affected', async () => {
      expect((await setHours('managerA', f.companyA, [day(1)])).status).toBe(200); // the Wednesday
      expect(await due('c-holiday', at(12 * 60 + 30))).toBe(iso(2 * 24 * 60 + 240)); // Thursday 12:30 local
      // Company B has no holiday: the same arrival there is due on Wednesday.
      clear();
      put(message('c-holiday-b', 'fake-facebook-1', at(12 * 60 + 30)));
      expect(find(await listFor('managerB'), 'c-holiday-b').dueAt).toBe(iso(24 * 60 + 240));
      expect((await setHours('managerA', f.companyA, [])).status).toBe(200);
    });

    it('the working hours of the company are shown and edited through the existing route', async () => {
      const got = await json(
        await send('GET', `/api/working-hours?companyId=${f.companyA}`, 'writerA'),
      );
      expect(got).toMatchObject({
        workDays: [1, 2, 3, 4, 5, 6],
        startMinute: 510,
        endMinute: 1050,
      });
      expect((await setHours('writerA', f.companyA)).status).toBe(403); // a Content Writer reads, never edits
    });
  });

  describe('reassignment never restarts the clock; after two the manager has it', () => {
    it('keeps the due time through every hand-over, counts only real reassignments, and tells the manager once', async () => {
      await resetWork();
      put(message('r-1', 'fake-linkedin-1', at(0)));
      const dueOf = async () => find(await listFor('managerA'), 'r-1');
      expect((await assign('managerA', 'r-1', 'writerA')).status).toBe(200); // first assignment: not a reassignment
      expect(await dueOf()).toMatchObject({
        reassignmentCount: 0,
        needsManager: false,
        dueAt: iso(240),
      });
      expect((await assign('writerA', 'r-1', 'writer2A')).status).toBe(200); // reassignment 1
      expect(await dueOf()).toMatchObject({
        reassignmentCount: 1,
        needsManager: false,
        dueAt: iso(240),
      });
      expect(await notes('managerA')).toHaveLength(0);
      expect((await assign('writer2A', 'r-1', 'execA')).status).toBe(200); // reassignment 2: the manager has it
      expect(await dueOf()).toMatchObject({
        reassignmentCount: 2,
        needsManager: true,
        dueAt: iso(240),
      });
      const told = await notes('managerA');
      expect(told).toHaveLength(1);
      expect(told[0]!.summary).toContain('handed on twice');
      expect(told[0]!.summary).not.toContain('Text of r-1');
      expect((await itemRow('r-1')).needs_manager_at).not.toBeNull();
      // A third hand-over, and clearing, tell nobody again.
      expect((await assign('execA', 'r-1', 'writerA')).status).toBe(200);
      expect((await assign('execA', 'r-1', null)).status).toBe(200);
      expect(await notes('managerA')).toHaveLength(1);
      expect(await dueOf()).toMatchObject({
        reassignmentCount: 3,
        needsManager: true,
        dueAt: iso(240),
      });
      const audit = await query(
        `select details from audit_events where action = 'inbox.assigned' and details->>'engineMessageId' = 'r-1' order by id`,
      );
      expect(audit.map((a) => a.details.reassignmentCount)).toEqual([0, 1, 2, 3]);
      expect(audit[2].details.needsManager).toBe(true);
    });

    it('clearing the assignee and assigning someone else is still a reassignment (it cannot dodge the count)', async () => {
      put(message('r-2', 'fake-linkedin-1', at(0)));
      await assign('managerA', 'r-2', 'writerA');
      await assign('managerA', 'r-2', null);
      await assign('managerA', 'r-2', 'writer2A');
      expect((await itemRow('r-2')).reassignment_count).toBe(1);
    });
  });

  describe('the escalation ladder (sweep)', () => {
    it('does nothing before the target, and a message nobody touched gets its row, then escalates', async () => {
      await resetWork();
      put(
        message('e-untouched', 'fake-linkedin-1', at(0)),
        message('e-outside', 'fake-linkedin-1', at(0), true),
      );
      await sweepAt(239);
      // Only an unanswered message gets a row (id and time, never text); the one answered outside DCC gets none.
      expect(await itemRow('e-outside')).toBeUndefined();
      const row = await itemRow('e-untouched');
      // Round 3 (E-03): the routing job of the same sweep gives it to someone who can reply (the system, no human assigner).
      expect(row).toMatchObject({
        assigned_by: null,
        assigned_automatically: true,
        priority: 'normal',
        first_response_at: null,
      });
      // Everyone who may reply is a candidate (the executive holds inbox.reply too); the tie goes to the lowest random id.
      expect([users.managerA, users.writerA, users.writer2A, users.execA]).toContain(
        row.assigned_to,
      );
      expect(JSON.stringify(row)).not.toContain('Text of');
      expect(await events('e-untouched')).toEqual([]);
      expect(await notes('managerA', 'inbox.escalated')).toHaveLength(0);
      // At 100% the assignee and the Digital Marketing Manager are told, once, however often the sweep runs.
      await sweepAt(240);
      await sweepAt(240);
      expect(await events('e-untouched')).toEqual([1]);
      expect(await notes('managerA')).toHaveLength(1);
      const assigneeName = Object.entries(users).find(([, id]) => id === row.assigned_to)![0];
      if (assigneeName !== 'managerA') expect(await notes(assigneeName)).toHaveLength(1);
      for (const other of ['writerA', 'writer2A', 'execA'])
        if (other !== assigneeName) expect(await notes(other)).toHaveLength(0);
      expect(await events('e-outside')).toEqual([]);
    });

    it('level 1 reminds the assignee and the manager; level 2 hands it to the least loaded backup; level 3 tells the executives', async () => {
      await resetWork();
      put(message('e-1', 'fake-linkedin-1', at(0)));
      // Open work already held: managerA 2, execA 1, writer2A none. writerA (the assignee) is never the backup.
      for (const [id, who] of [
        ['e-load-1', 'managerA'],
        ['e-load-2', 'managerA'],
        ['e-load-3', 'execA'],
      ] as const) {
        put(message(id, 'fake-linkedin-1', at(300)));
        expect((await assign('managerA', id, who)).status).toBe(200);
      }
      expect((await assign('managerA', 'e-1', 'writerA')).status).toBe(200);
      const told = async (type = 'inbox.escalated') =>
        (
          await query(`select count(*)::int as n from notifications where event_type = $1`, [type])
        )[0].n as number;

      await sweepAt(239);
      expect(await events('e-1')).toEqual([]);

      // Level 1 at 100%: the assignee and the manager. The audit event has no human actor.
      await sweepAt(240);
      await sweepAt(240);
      expect(await events('e-1')).toEqual([1]);
      expect(await notes('writerA')).toHaveLength(1);
      expect(await notes('managerA')).toHaveLength(1);
      expect(await notes('execA')).toHaveLength(0);
      const audit1 = (
        await query(
          `select actor_user_id, actor_subject, details from audit_events
            where action = 'inbox.escalated' and details->>'engineMessageId' = 'e-1' order by id`,
        )
      )[0];
      expect(audit1.actor_user_id).toBeNull();
      expect(audit1.details).toMatchObject({ level: 1, priority: 'normal' });

      // Still level 1 one minute before 150%.
      await sweepAt(359);
      expect(await events('e-1')).toEqual([1]);
      expect((await itemRow('e-1')).assigned_to).toBe(users.writerA);

      // Level 2 at 150%: moved to the holder of inbox.reply with the fewest open messages (a Content Writer counts).
      const before = await told();
      await sweepAt(360);
      await sweepAt(360);
      expect(await events('e-1')).toEqual([1, 2]);
      const moved = await itemRow('e-1');
      expect(moved.assigned_to).toBe(users.writer2A);
      expect(moved.assigned_by).toBeNull(); // a system move has no human assigner
      expect(moved.reassignment_count).toBe(0); // and is not a reassignment by a person
      expect((await notes('writer2A')).map((n) => n.summary).join('|')).toContain('handed to you');
      expect((await notes('writerA')).map((n) => n.summary).join('|')).toContain(
        'handed to someone else',
      );
      expect(await told()).toBe(before + 2); // the new holder and the previous one, once
      const list = find(await listFor('managerA'), 'e-1');
      expect(list.assignedTo).toBe(users.writer2A);
      // The due time did not move with the message.
      expect(list.dueAt).toBe(iso(240));

      // Level 3 at 200%: the Marketing & Communications Manager (company_executive and group_marketing).
      await sweepAt(479);
      expect(await events('e-1')).toEqual([1, 2]);
      expect(await notes('execA')).toHaveLength(0);
      await sweepAt(480);
      await sweepAt(480);
      expect(await events('e-1')).toEqual([1, 2, 3]);
      expect((await notes('execA')).at(-1)!.summary).toContain('twice its response time');
      expect((await notes('gm')).length).toBe(1);
      // Nobody of company B or another group is told anything about company A.
      for (const outsider of ['managerB', 'creatorB', 'otherGroupAdmin', 'managerC'])
        expect(await notes(outsider)).toEqual([]);
      // Every level is on the audit trail once.
      const levels = (
        await query(
          `select details->>'level' as level from audit_events where action = 'inbox.escalated' and details->>'engineMessageId' = 'e-1' order by id`,
        )
      ).map((r) => r.level);
      expect(levels).toEqual(['1', '2', '3']);
    });

    it('the backup is chosen by load every time: ties go to the lowest id, and the next one goes to whoever is now lightest', async () => {
      // State of the test above: managerA holds 2 open messages, execA 1, writer2A 1 (e-1 was moved to it).
      put(message('e-2', 'fake-linkedin-1', at(0)), message('e-3', 'fake-linkedin-1', at(0)));
      expect((await assign('managerA', 'e-2', 'writerA')).status).toBe(200);
      expect((await assign('managerA', 'e-3', 'writerA')).status).toBe(200);
      await sweepAt(360);
      const tied = [users.execA!, users.writer2A!].sort();
      // First: execA and writer2A are tied at 1 open message each, managerA has 2: the lowest id of the tie.
      expect((await itemRow('e-2')).assigned_to).toBe(tied[0]);
      // Second: the first of them now holds 2, the other 1: the other one.
      expect((await itemRow('e-3')).assigned_to).toBe(tied[1]);
    });

    it('with nobody to hand it to, the manager is told instead and the message stays where it is', async () => {
      await resetWork();
      put(message('n-1', 'fake-youtube-1', at(0)));
      expect((await assign('managerC', 'n-1', 'managerC', accountC)).status).toBe(200);
      await sweepAt(240);
      await sweepAt(360);
      await sweepAt(360);
      expect(await events('n-1')).toEqual([1, 2]);
      expect((await itemRow('n-1')).assigned_to).toBe(users.managerC);
      const summaries = (await notes('managerC')).map((n) => n.summary);
      expect(summaries.some((s) => s.includes('nobody else to hand it to'))).toBe(true);
      const audit = await query(
        `select details from audit_events where action = 'inbox.escalated' and details->>'level' = '2' and details->>'engineMessageId' = 'n-1'`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].details.noBackup).toBe(true);
    });

    it('an answered message never escalates, however late; a message older than seven days is left alone', async () => {
      await resetWork();
      put(
        message('a-1', 'fake-linkedin-1', at(0)),
        message('a-old', 'fake-linkedin-1', at(-10 * 24 * 60)),
      );
      expect((await assign('managerA', 'a-1', 'writerA')).status).toBe(200);
      const reply = await send('POST', '/api/inbox/reply', 'writerA', {
        socialAccountId: f.accountA,
        engineMessageId: 'a-1',
        text: 'Thank you for writing to us.',
      });
      expect(reply.status).toBe(201);
      await sweepAt(24 * 60);
      expect(await events('a-1')).toEqual([]);
      // Eleven days old when the sweep looks: outside its seven-day window, so no row and no event.
      expect(await events('a-old')).toEqual([]);
      expect(await itemRow('a-old')).toBeUndefined();
      expect(find(await listFor('managerA'), 'a-1')).toMatchObject({
        escalationLevel: 0,
        replied: true,
      });
    });

    it('the sweep reads each company on its own: an engine error on one account does not stop the others', async () => {
      await resetWork();
      put(message('s-1', 'fake-facebook-1', at(0)), message('s-2', 'fake-youtube-1', at(0)));
      const original = fake.listInbox.bind(fake);
      fake.listInbox = async (range, channel) => {
        if (channel === 'fake-facebook-1') throw new Error('engine down');
        return original(range, channel);
      };
      try {
        await sweepAt(240);
      } finally {
        fake.listInbox = original;
      }
      expect(await events('s-2')).toEqual([1]);
      expect(await itemRow('s-1')).toBeUndefined();
    });
  });

  describe('reading the inbox also runs the ladder', () => {
    it('records each level once for a message DCC holds, however often the list is read', async () => {
      await resetWork();
      // Company B works round the clock here, so ten hours old is past 200% of 240 minutes whatever the time of day.
      const r = await send('PUT', '/api/working-hours', 'managerB', {
        companyId: f.companyB,
        workDays: [0, 1, 2, 3, 4, 5, 6],
        startMinute: 0,
        endMinute: 1440,
        utcOffsetMinutes: 0,
        holidays: [],
      });
      expect(r.status).toBe(200);
      put(message('l-1', 'fake-facebook-1', new Date(Date.now() - 600 * MINUTE)));
      expect((await assign('managerB', 'l-1', 'creatorB', f.accountB)).status).toBe(200);
      const first = await json(await send('GET', '/api/inbox', 'managerB'));
      expect(find(first, 'l-1')).toMatchObject({ escalationLevel: 3, overdue: true });
      expect(await events('l-1')).toEqual([1, 2, 3]);
      const count = async () =>
        (
          await query(
            `select count(*)::int as n from notifications where event_type = 'inbox.escalated'`,
          )
        )[0].n as number;
      const after = await count();
      await send('GET', '/api/inbox', 'managerB');
      await send('GET', '/api/inbox', 'creatorB');
      expect(await events('l-1')).toEqual([1, 2, 3]);
      expect(await count()).toBe(after);
      // Level 2 moved it to the other holder in company B.
      expect((await itemRow('l-1')).assigned_to).toBe(users.managerB);
    });
  });

  describe('settings', () => {
    it('a Content Writer cannot change them; the manager and the administrator can; each change is audited', async () => {
      expect(
        (
          await send('PUT', '/api/inbox/settings', 'writerA', {
            companyId: f.companyA,
            urgentTargetMinutes: 30,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await send('PUT', '/api/inbox/settings', 'auditorA', {
            companyId: f.companyA,
            urgentTargetMinutes: 30,
          })
        ).status,
      ).toBe(403);
      const r = await send('PUT', '/api/inbox/settings', 'managerA', {
        companyId: f.companyA,
        urgentTargetMinutes: 30,
        lowTargetMinutes: 2880,
      });
      expect(r.status).toBe(200);
      expect(await json(r)).toMatchObject({
        urgentTargetMinutes: 30,
        normalTargetMinutes: 240,
        lowTargetMinutes: 2880,
        responseTargetMinutes: 240,
        urgentRoundTheClock: false,
      });
      expect(
        (
          await send('PUT', '/api/inbox/settings', 'adminA', {
            companyId: f.companyA,
            urgentTargetMinutes: 60,
            lowTargetMinutes: 1440,
          })
        ).status,
      ).toBe(200);
      const audit = await query(
        `select actor_user_id, details from audit_events where action = 'inbox.response_target_set' order by id desc limit 2`,
      );
      expect(audit.map((a) => a.actor_user_id)).toEqual([f.users.adminA, users.managerA]);
      expect(audit[1].details.to).toMatchObject({
        urgentTargetMinutes: 30,
        lowTargetMinutes: 2880,
      });
      expect(await settingsOf('writerA', f.companyA)).toMatchObject({
        urgentTargetMinutes: 60,
        lowTargetMinutes: 1440,
      });
    });

    it('the old field is the normal target, and bad input is refused', async () => {
      const r = await send('PUT', '/api/inbox/settings', 'managerA', {
        companyId: f.companyA,
        responseTargetMinutes: 120,
      });
      expect(await json(r)).toMatchObject({ responseTargetMinutes: 120, normalTargetMinutes: 120 });
      expect(
        (
          await query(
            `select response_target_minutes, normal_target_minutes from inbox_settings where company_id = $1`,
            [f.companyA],
          )
        )[0],
      ).toEqual({
        response_target_minutes: 120,
        normal_target_minutes: 120,
      });
      const bad = (body: unknown) => send('PUT', '/api/inbox/settings', 'managerA', body);
      expect((await bad({ companyId: f.companyA })).status).toBe(400); // nothing to change
      expect((await bad({ companyId: f.companyA, urgentTargetMinutes: 0 })).status).toBe(400);
      expect((await bad({ companyId: f.companyA, lowTargetMinutes: 1.5 })).status).toBe(400);
      expect((await bad({ companyId: f.companyA, normalTargetMinutes: 43_201 })).status).toBe(400);
      expect((await bad({ companyId: f.companyA, urgentRoundTheClock: 'yes' })).status).toBe(400);
      expect(
        (await bad({ companyId: f.companyA, responseTargetMinutes: 5, normalTargetMinutes: 6 }))
          .status,
      ).toBe(400);
      expect(await settingsOf('managerA', f.companyA)).toMatchObject({ normalTargetMinutes: 120 });
      await bad({ companyId: f.companyA, responseTargetMinutes: null }); // back to the default
      expect(await settingsOf('managerA', f.companyA)).toMatchObject({ normalTargetMinutes: 240 });
    });
  });

  describe('the monthly count of messages that reached 200%', () => {
    it('counts each miss once, per company and month, and shows nobody another company', async () => {
      await resetWork();
      // Two misses in the month of BASE, one five weeks later (always another month).
      put(
        message('m-1', 'fake-linkedin-1', at(0)),
        message('m-2', 'fake-linkedin-1', at(0)),
        message('m-3', 'fake-linkedin-1', at(35 * 24 * 60)),
        message('m-4', 'fake-linkedin-1', at(0), true), // answered outside DCC: never a miss
      );
      await sweepAt(480);
      await sweepAt(480);
      await sweepAt(35 * 24 * 60 + 480);
      await sweepAt(35 * 24 * 60 + 480);
      const monthOf = (minutes: number) =>
        new Date(BASE + minutes * MINUTE + 3 * 60 * MINUTE).toISOString().slice(0, 7);
      const m1 = monthOf(480);
      const m2 = monthOf(35 * 24 * 60 + 480);
      expect(m1).not.toBe(m2);
      const report = await json(await send('GET', '/api/reports/inbox-misses', 'auditorA'));
      expect(report).toEqual([
        { companyId: f.companyA, month: m2, misses: 1 },
        { companyId: f.companyA, month: m1, misses: 2 },
      ]);
      expect(
        await json(await send('GET', `/api/reports/inbox-misses?month=${m1}`, 'auditorA')),
      ).toEqual([{ companyId: f.companyA, month: m1, misses: 2 }]);
      // The group administrator reads every company of the group; each other person only their own.
      expect(
        (
          await json(
            await send('GET', `/api/reports/inbox-misses?companyId=${f.companyA}`, 'groupAdmin'),
          )
        ).length,
      ).toBe(2);
      expect(await json(await send('GET', '/api/reports/inbox-misses', 'managerB'))).toEqual([]);
      expect(
        await json(
          await send('GET', `/api/reports/inbox-misses?companyId=${f.companyA}`, 'managerB'),
        ),
      ).toEqual([]);
      expect(await json(await send('GET', '/api/reports/inbox-misses', 'otherGroupAdmin'))).toEqual(
        [],
      );
      // Someone who cannot read reports gets nothing (a Content Writer holds no report.read).
      expect((await send('GET', '/api/reports/inbox-misses', 'writerA')).status).toBe(403);
      expect(
        (await send('GET', '/api/reports/inbox-misses?month=2026-13', 'auditorA')).status,
      ).toBe(400);
    });

    it('the company month follows its own time zone', async () => {
      // 2026-xx-01 22:00 UTC is already the 2nd at UTC+3: a miss then belongs to the next month there.
      await query(`delete from escalation_events`);
      await query(`delete from inbox_items`);
      const item = (
        await query(
          `insert into inbox_items (company_id, social_account_id, engine_message_id, received_at)
           values ($1, $2, 'tz-1', now()) returning id`,
          [f.companyA, f.accountA],
        )
      )[0].id;
      await query(
        `insert into escalation_events (company_id, kind, target_id, level, created_at) values ($1, 'inbox', $2, 3, '2026-03-31 22:30:00+00')`,
        [f.companyA, item],
      );
      expect(await json(await send('GET', '/api/reports/inbox-misses', 'auditorA'))).toEqual([
        { companyId: f.companyA, month: '2026-04', misses: 1 }, // Ethiopia, UTC+3
      ]);
    });
  });

  describe("another company's people and the database", () => {
    const itemId = () => '00000000-0000-4000-8000-0000000000aa';
    it('cannot read or change the settings, items or escalation record of company A', async () => {
      await resetWork();
      put(message('x-1', 'fake-linkedin-1', at(0)));
      expect((await assign('managerA', 'x-1', 'writerA')).status).toBe(200);
      await sweepAt(240);
      expect(await events('x-1')).toEqual([1]);

      // Through the API.
      const bSettings = await json(await send('GET', '/api/inbox/settings', 'managerB'));
      expect(bSettings.map((s: any) => s.companyId)).toEqual([f.companyB]);
      expect(
        [403, 404].includes(
          (
            await send('PUT', '/api/inbox/settings', 'managerB', {
              companyId: f.companyA,
              urgentTargetMinutes: 1,
            })
          ).status,
        ),
      ).toBe(true);
      expect((await settingsOf('managerA', f.companyA)).urgentTargetMinutes).toBe(60);
      expect((await listFor('managerB')).filter((m: any) => m.companyId === f.companyA)).toEqual(
        [],
      );

      // In the database, as company B's person.
      const tenant = new TenantDb(database);
      const asB = ctx(users.managerB, [], [f.companyB]);
      expect(
        await tenant.run(asB, (trx) => trx.selectFrom('inbox_items').selectAll().execute()),
      ).toEqual([]);
      expect(
        await tenant.run(asB, (trx) => trx.selectFrom('escalation_events').selectAll().execute()),
      ).toEqual([]);
      expect(
        await tenant.run(asB, (trx) =>
          trx
            .selectFrom('inbox_settings')
            .selectAll()
            .where('company_id', '=', f.companyA)
            .execute(),
        ),
      ).toEqual([]);
      const changed = await tenant.run(asB, (trx) =>
        trx
          .updateTable('inbox_items')
          .set({ priority: 'low', needs_manager: true, reassignment_count: 9 })
          .returning('id')
          .execute(),
      );
      expect(changed).toEqual([]);
      const settingsChanged = await tenant.run(asB, (trx) =>
        trx
          .updateTable('inbox_settings')
          .set({ urgent_target_minutes: 1, urgent_round_the_clock: true })
          .where('company_id', '=', f.companyA)
          .returning('company_id')
          .execute(),
      );
      expect(settingsChanged).toEqual([]);
      await expect(
        tenant.run(asB, (trx) =>
          trx
            .insertInto('escalation_events')
            .values({ company_id: f.companyA, kind: 'inbox', target_id: itemId(), level: 3 })
            .execute(),
        ),
      ).rejects.toThrow();
      await expect(
        tenant.run(asB, (trx) =>
          trx
            .insertInto('inbox_settings')
            .values({
              company_id: f.companyA,
              urgent_target_minutes: 1,
              updated_by: users.managerB,
            })
            .execute(),
        ),
      ).rejects.toThrow();
      // Company A's rows are untouched.
      const row = await itemRow('x-1');
      expect(row).toMatchObject({
        priority: 'normal',
        needs_manager: false,
        reassignment_count: 0,
      });
    });
    it('the database refuses a priority that is not urgent, normal or low, and a half-recorded setter', async () => {
      await expect(query(`update inbox_items set priority = 'critical'`)).rejects.toThrow();
      await expect(
        query(`update inbox_items set priority_set_by = $1`, [users.writerA]),
      ).rejects.toThrow();
      await expect(query(`update inbox_settings set urgent_target_minutes = 0`)).rejects.toThrow();
    });
  });
});

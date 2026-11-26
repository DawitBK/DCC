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
const AMHARIC = 'ሰላም፣ እባክዎ ስለ አገልግሎቱ ያሳውቁኝ';

/**
 * Round 3, routing (E-03, E-11, E-15, B-37, E-06): responders per company and language, automatic assignment by the
 * sweep, claim, and the language-aware backup at 150%.
 *
 * Every date is relative to `BASE`, a Tuesday 08:30 local (05:30 UTC) between 14 and 21 days ago, as in the inbox
 * clock tests; the sweep is given the `now` it needs. Company A has the cast below; company B and D are the others.
 *
 *   managerA  company_marketing_manager A    (manages the inbox, replies)
 *   writerA, writer2A, writer3A  content_creator A   (reply)
 *   execA     company_executive A            (replies too: the executive holds `inbox.reply`)
 *   adminA    company_admin A (fixture)      (manages, cannot reply)
 *   auditorA  auditor A (fixture)            (reads reports only)
 *   managerB  company B, creatorB (fixture)  (the other company)
 *   adminD    the only person of company D   (manages, nobody there can reply)
 */
describe('inbox routing: responders, automatic assignment, claim (Round 3)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let fake: FakeEngine;
  let database: Database;
  let companyD: string;
  const users: Record<string, string> = {};
  const cookies = new Map<string, string>();

  const today = Date.now();
  const probe = new Date(today - 14 * DAY);
  probe.setUTCHours(5, 30, 0, 0);
  while (probe.getUTCDay() !== 2) probe.setUTCDate(probe.getUTCDate() - 1);
  const BASE = probe.getTime();
  const at = (minutes: number) => new Date(BASE + minutes * MINUTE);

  const message = (
    id: string,
    channel: string,
    receivedAt: Date,
    options: { replied?: boolean; text?: string } = {},
  ): InboxMessage => ({
    engineMessageId: id,
    engineChannelId: channel,
    kind: 'comment',
    authorName: 'A customer',
    text: options.text ?? `Text of ${id}`,
    receivedAt,
    engineOperationId: null,
    replied: options.replied ?? false,
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
    companyD = await one(
      `insert into companies (group_id, name, slug) values ($1, 'Company D', 'd') returning id`,
      [f.groupId],
    );
    const brandD = await one(
      `insert into brands (company_id, name, slug) values ($1, 'Brand D', 'brand-d') returning id`,
      [companyD],
    );
    await one(
      `insert into social_accounts (company_id, brand_id, platform, display_name, handle, engine_channel_id)
       values ($1, $2, 'youtube', 'D channel', '@d', 'fake-youtube-d') returning id`,
      [companyD, brandD],
    );
    await addUser('managerA', 'company_marketing_manager', f.companyA);
    await addUser('writerA', 'content_creator', f.companyA);
    await addUser('writer2A', 'content_creator', f.companyA);
    await addUser('writer3A', 'content_creator', f.companyA);
    await addUser('execA', 'company_executive', f.companyA);
    await addUser('managerB', 'company_marketing_manager', f.companyB);
    await addUser('adminD', 'company_admin', companyD);
    await owner.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    base = await listenForTests(app);
    fake = app.get(OPERATIONAL_ENGINE);
    clear();
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
  const nameOf = (id: string | null) =>
    Object.entries({ ...users, ...f.users }).find(([, v]) => v === id)?.[0] ?? null;
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
  const claim = (who: string, id: string, account = f.accountA) =>
    send('POST', '/api/inbox/claim', who, { socialAccountId: account, engineMessageId: id });
  const sweepAt = async (minutes: number) => {
    const failures = await app.get(SweepService).runOnce(at(minutes));
    expect(failures).toEqual([]);
  };
  const setResponders = (
    who: string,
    companyId: string,
    responders: Array<{ user: string; kind: 'primary' | 'backup'; languages: string[] }>,
  ) =>
    send('PUT', '/api/inbox/responders', who, {
      companyId,
      responders: responders.map((r) => ({
        userId: uid(r.user),
        kind: r.kind,
        languages: r.languages,
      })),
    });
  const resetWork = async () => {
    await query(`delete from escalation_events`);
    await query(`delete from notifications`);
    await query(`delete from inbox_items`);
    await query(`delete from inbox_responders`);
    clear();
  };
  const itemRow = async (messageId: string) =>
    (await query(`select * from inbox_items where engine_message_id = $1`, [messageId]))[0];
  const notes = async (who: string, type: string) =>
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
  /** Gives `who` this many open assigned messages (answered by nobody), so the load is known. */
  const loadUp = async (who: string, count: number, tag: string) => {
    for (let i = 0; i < count; i += 1) {
      const id = `load-${tag}-${who}-${i}`;
      put(message(id, 'fake-linkedin-1', at(300))); // recent: it must not escalate itself in these tests
      expect((await assign('managerA', id, who)).status).toBe(200);
    }
  };

  describe('responders (E-15, B-37)', () => {
    it('a manager replaces the list of a company; any reader sees it; each change is audited with before and after', async () => {
      await resetWork();
      const r = await setResponders('managerA', f.companyA, [
        { user: 'writerA', kind: 'primary', languages: ['en'] },
        { user: 'writer2A', kind: 'primary', languages: ['am'] },
        { user: 'writer3A', kind: 'backup', languages: ['en', 'am'] },
      ]);
      expect(r.status).toBe(200);
      const saved = await json(r);
      expect(saved).toHaveLength(3);
      expect(saved).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: users.writerA,
            displayName: 'sub-writerA',
            kind: 'primary',
            languages: ['en'],
            canReply: true,
          }),
          expect.objectContaining({
            userId: users.writer3A,
            kind: 'backup',
            languages: ['en', 'am'],
          }),
        ]),
      );
      // A Content Writer reads the list but cannot change it.
      const got = await json(
        await send('GET', `/api/inbox/responders?companyId=${f.companyA}`, 'writerA'),
      );
      expect(got).toHaveLength(3);
      expect(
        (
          await setResponders('writerA', f.companyA, [
            { user: 'writerA', kind: 'primary', languages: ['en'] },
          ])
        ).status,
      ).toBe(403);
      // The company administrator manages the inbox (and need not reply himself).
      expect(
        (
          await setResponders('adminA', f.companyA, [
            { user: 'writerA', kind: 'primary', languages: ['en', 'am'] },
          ])
        ).status,
      ).toBe(200);
      const audit = await query(
        `select actor_user_id, company_id, details from audit_events where action = 'inbox.responder_set' order by id`,
      );
      expect(audit).toHaveLength(2);
      expect(audit[0].actor_user_id).toBe(users.managerA);
      expect(audit[0].company_id).toBe(f.companyA);
      expect(audit[0].details.from).toEqual([]);
      expect(audit[0].details.to).toHaveLength(3);
      expect(audit[1].actor_user_id).toBe(f.users.adminA);
      expect(audit[1].details.from).toHaveLength(3);
      expect(audit[1].details.to).toEqual([
        { userId: users.writerA, kind: 'primary', languages: ['en', 'am'] },
      ]);
      // An empty list clears it.
      expect((await setResponders('managerA', f.companyA, [])).status).toBe(200);
      expect(await query(`select 1 from inbox_responders`)).toHaveLength(0);
    });

    it('refuses a person who cannot reply for the company, duplicates, bad languages and bad input', async () => {
      await resetWork();
      const auditCount = async () =>
        (await query(`select 1 from audit_events where action = 'inbox.responder_set'`)).length;
      const auditBefore = await auditCount();
      // adminA manages but holds no inbox.reply; managerB belongs to company B; a made-up id is nobody.
      for (const who of ['adminA', 'managerB', 'auditorA']) {
        const r = await setResponders('managerA', f.companyA, [
          { user: who, kind: 'primary', languages: ['en'] },
        ]);
        expect(r.status).toBe(400);
      }
      expect(
        (
          await send('PUT', '/api/inbox/responders', 'managerA', {
            companyId: f.companyA,
            responders: [
              {
                userId: '00000000-0000-4000-8000-000000000123',
                kind: 'primary',
                languages: ['en'],
              },
            ],
          })
        ).status,
      ).toBe(400);
      const dup = await send('PUT', '/api/inbox/responders', 'managerA', {
        companyId: f.companyA,
        responders: [
          { userId: users.writerA, kind: 'primary', languages: ['en'] },
          { userId: users.writerA, kind: 'backup', languages: ['am'] },
        ],
      });
      expect(dup.status).toBe(400);
      for (const bad of [
        { kind: 'primary', languages: [] },
        { kind: 'primary', languages: ['fr'] },
        { kind: 'primary', languages: ['en', 'en'] },
        { kind: 'boss', languages: ['en'] },
      ]) {
        expect(
          (
            await send('PUT', '/api/inbox/responders', 'managerA', {
              companyId: f.companyA,
              responders: [{ userId: users.writerA, ...bad }],
            })
          ).status,
        ).toBe(400);
      }
      expect(
        (await send('PUT', '/api/inbox/responders', 'managerA', { responders: [] })).status,
      ).toBe(400);
      expect(await query(`select 1 from inbox_responders`)).toHaveLength(0);
      // A refused change leaves nothing on the audit trail.
      expect(await auditCount()).toBe(auditBefore);
    });

    it('lists who can be chosen, for a manager who cannot reply, and for nobody else', async () => {
      const mine = await json(
        await send('GET', `/api/inbox/responders/candidates?companyId=${f.companyA}`, 'adminA'),
      );
      const ids = mine.map((p: any) => p.userId);
      for (const who of ['managerA', 'writerA', 'writer2A', 'writer3A', 'execA'])
        expect(ids).toContain(users[who]);
      for (const who of ['managerB', 'adminA', 'auditorA']) expect(ids).not.toContain(uid(who));
      expect(
        (await send('GET', `/api/inbox/responders/candidates?companyId=${f.companyA}`, 'writerA'))
          .status,
      ).toBe(403);
      expect(
        (await send('GET', `/api/inbox/responders/candidates?companyId=${f.companyA}`, 'managerB'))
          .status,
      ).toBe(404);
    });

    it('shows a responder who lost the permission as unable to reply, and the router ignores them', async () => {
      await resetWork();
      expect(
        (
          await setResponders('managerA', f.companyA, [
            { user: 'writerA', kind: 'primary', languages: ['en'] },
            { user: 'writer2A', kind: 'primary', languages: ['en'] },
          ])
        ).status,
      ).toBe(200);
      await query(`update memberships set role = 'auditor' where user_id = $1`, [users.writerA]);
      try {
        const list = await json(
          await send('GET', `/api/inbox/responders?companyId=${f.companyA}`, 'managerA'),
        );
        expect(list.find((r: any) => r.userId === users.writerA).canReply).toBe(false);
        expect(list.find((r: any) => r.userId === users.writer2A).canReply).toBe(true);
        put(message('lost-1', 'fake-linkedin-1', at(0)));
        await sweepAt(10);
        expect((await itemRow('lost-1')).assigned_to).toBe(users.writer2A);
      } finally {
        await query(`update memberships set role = 'content_creator' where user_id = $1`, [
          users.writerA,
        ]);
      }
    });

    it('another company cannot read or change the list (404), and its own people cannot be put on it', async () => {
      await resetWork();
      await setResponders('managerA', f.companyA, [
        { user: 'writerA', kind: 'primary', languages: ['en'] },
      ]);
      expect(
        (await send('GET', `/api/inbox/responders?companyId=${f.companyA}`, 'managerB')).status,
      ).toBe(404);
      expect(
        (
          await setResponders('managerB', f.companyA, [
            { user: 'writerA', kind: 'primary', languages: ['en'] },
          ])
        ).status,
      ).toBe(404);
      expect(
        (await send('GET', `/api/inbox/responders?companyId=${f.companyA}`, 'otherGroupAdmin'))
          .status,
      ).toBe(403); // another group's administrator: refused before the company is even looked up
      expect(
        (await send('GET', `/api/inbox/responders?companyId=${f.companyA}`, 'creatorB')).status,
      ).toBe(404);
      // The database too: company B's person sees no row of company A and cannot write one.
      const tenant = new TenantDb(database);
      const asB = ctx(users.managerB, [], [f.companyB]);
      expect(
        await tenant.run(asB, (trx) => trx.selectFrom('inbox_responders').selectAll().execute()),
      ).toEqual([]);
      await expect(
        tenant.run(asB, (trx) =>
          trx
            .insertInto('inbox_responders')
            .values({
              company_id: f.companyA,
              user_id: users.writer3A,
              kind: 'primary',
              languages: ['en'],
              updated_by: users.managerB,
            })
            .execute(),
        ),
      ).rejects.toThrow();
      expect(
        await tenant.run(asB, (trx) =>
          trx
            .updateTable('inbox_responders')
            .set({ kind: 'backup' })
            .returning('user_id')
            .execute(),
        ),
      ).toEqual([]);
      expect(
        await tenant.run(asB, (trx) =>
          trx.deleteFrom('inbox_responders').returning('user_id').execute(),
        ),
      ).toEqual([]);
      expect(await query(`select kind from inbox_responders`)).toEqual([{ kind: 'primary' }]);
      // The database refuses a language that is not en or am, and an empty list.
      await expect(query(`update inbox_responders set languages = '{fr}'`)).rejects.toThrow();
      await expect(query(`update inbox_responders set languages = '{}'`)).rejects.toThrow();
    });
  });

  describe('automatic assignment (E-03, E-11)', () => {
    it('gives a message to the primary responder of its language, and says so in the list', async () => {
      await resetWork();
      await setResponders('managerA', f.companyA, [
        { user: 'writerA', kind: 'primary', languages: ['en'] },
        { user: 'writer2A', kind: 'primary', languages: ['am'] },
      ]);
      put(
        message('l-en', 'fake-linkedin-1', at(0), { text: 'Hello, when will it be ready?' }),
        message('l-am', 'fake-linkedin-1', at(0), { text: AMHARIC }),
        message('l-mixed', 'fake-linkedin-1', at(0), { text: `Thanks ${AMHARIC}` }),
      );
      await sweepAt(10);
      expect((await itemRow('l-en')).assigned_to).toBe(users.writerA);
      expect((await itemRow('l-am')).assigned_to).toBe(users.writer2A);
      // Any Ethiopic letter makes it Amharic.
      expect((await itemRow('l-mixed')).assigned_to).toBe(users.writer2A);
      const list = await listFor('managerA');
      expect(find(list, 'l-en')).toMatchObject({
        language: 'en',
        assignedAutomatically: true,
        assignedTo: users.writerA,
        assignedToName: 'sub-writerA',
      });
      expect(find(list, 'l-am')).toMatchObject({ language: 'am', assignedAutomatically: true });
    });

    it('the system assignment is audited, notifies the assignee, has no human assigner, is no reassignment and keeps the due time', async () => {
      await resetWork();
      await setResponders('managerA', f.companyA, [
        { user: 'writerA', kind: 'primary', languages: ['en', 'am'] },
      ]);
      put(message('a-1', 'fake-linkedin-1', at(0)));
      await sweepAt(10);
      const row = await itemRow('a-1');
      expect(row).toMatchObject({
        assigned_to: users.writerA,
        assigned_by: null,
        assigned_automatically: true,
        reassignment_count: 0,
        needs_manager: false,
        first_response_at: null,
      });
      expect(row.assigned_at).not.toBeNull();
      const told = await notes('writerA', 'inbox.assigned');
      expect(told).toHaveLength(1);
      expect(told[0]!.summary).toContain('automatically');
      expect(told[0]!.summary).not.toContain('Text of a-1');
      const audit = await query(
        `select actor_user_id, actor_subject, company_id, details from audit_events
          where action = 'inbox.auto_assigned' and details->>'engineMessageId' = 'a-1'`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].actor_user_id).toBeNull();
      expect(audit[0].actor_subject).toBe('system:inbox-routing');
      expect(audit[0].company_id).toBe(f.companyA);
      expect(audit[0].details).toMatchObject({
        engineMessageId: 'a-1',
        assignedTo: users.writerA,
        language: 'en',
        via: 'primary_language',
      });
      expect(JSON.stringify(audit[0].details)).not.toContain('Text of');
      // The clock runs from the arrival: 4 working hours after 08:30 local.
      expect(find(await listFor('managerA'), 'a-1').dueAt).toBe(at(240).toISOString());
      // A person handing it on is the first reassignment, and ends "assigned automatically".
      expect((await assign('writerA', 'a-1', 'writer2A')).status).toBe(200);
      const handed = await itemRow('a-1');
      expect(handed).toMatchObject({
        assigned_to: users.writer2A,
        assigned_by: users.writerA,
        assigned_automatically: false,
        reassignment_count: 1,
      });
      expect(find(await listFor('managerA'), 'a-1')).toMatchObject({
        assignedAutomatically: false,
        dueAt: at(240).toISOString(),
      });
    });

    it('chooses the person with the fewest open messages, ties by the lowest id, and counts what it just gave', async () => {
      await resetWork();
      await setResponders('managerA', f.companyA, [
        { user: 'writerA', kind: 'primary', languages: ['en'] },
        { user: 'writer2A', kind: 'primary', languages: ['en'] },
        { user: 'writer3A', kind: 'primary', languages: ['en'] },
      ]);
      await loadUp('writerA', 2, 'a');
      await loadUp('writer2A', 1, 'a');
      // writer3A has none: the first new message goes there; the next ones even out.
      put(message('f-1', 'fake-linkedin-1', at(1)));
      await sweepAt(10);
      expect(nameOf((await itemRow('f-1')).assigned_to)).toBe('writer3A');
      put(message('f-2', 'fake-linkedin-1', at(2)));
      await sweepAt(10);
      // writer2A and writer3A now hold 1 each: the lowest id of the two.
      const tied = [users.writer2A!, users.writer3A!].sort()[0];
      expect((await itemRow('f-2')).assigned_to).toBe(tied);
      // Answered messages are not "open": answering frees the load.
      await query(
        `update inbox_items set first_response_at = now(), first_response_by = assigned_to where assigned_to = $1`,
        [users.writerA],
      );
      put(message('f-3', 'fake-linkedin-1', at(3)));
      await sweepAt(10);
      const open = async (who: string) =>
        Number(
          (
            await query(
              `select count(*)::int as n from inbox_items where assigned_to = $1 and first_response_at is null`,
              [users[who]],
            )
          )[0].n,
        );
      // After f-3 nobody holds more than 2 and the spread is at most one message.
      const loads = [await open('writerA'), await open('writer2A'), await open('writer3A')];
      expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
    });

    it('falls back: any primary, then any holder who is not a backup, never a backup', async () => {
      await resetWork();
      // Only an Amharic primary: an English message still goes to a primary.
      await setResponders('managerA', f.companyA, [
        { user: 'writer2A', kind: 'primary', languages: ['am'] },
        { user: 'writer3A', kind: 'backup', languages: ['en', 'am'] },
      ]);
      put(message('fb-1', 'fake-linkedin-1', at(0), { text: 'English only' }));
      await sweepAt(10);
      expect((await itemRow('fb-1')).assigned_to).toBe(users.writer2A);
      expect((await itemRow('fb-1')).assigned_automatically).toBe(true);
      expect(
        (
          await query(
            `select details from audit_events where action = 'inbox.auto_assigned' and details->>'engineMessageId' = 'fb-1'`,
          )
        )[0].details.via,
      ).toBe('primary');
      // No primary at all, only a backup: someone else who may reply, never the backup.
      await resetWork();
      await setResponders('managerA', f.companyA, [
        { user: 'writer3A', kind: 'backup', languages: ['en', 'am'] },
      ]);
      for (let i = 0; i < 4; i += 1) put(message(`fb-b-${i}`, 'fake-linkedin-1', at(i)));
      await sweepAt(10);
      const givenTo = new Set<string | null>();
      for (let i = 0; i < 4; i += 1) givenTo.add(nameOf((await itemRow(`fb-b-${i}`)).assigned_to));
      expect(givenTo.has('writer3A')).toBe(false);
      expect(givenTo.has(null)).toBe(false);
      for (const who of givenTo)
        expect(['managerA', 'writerA', 'writer2A', 'execA']).toContain(who);
      expect(
        (
          await query(
            `select details from audit_events where action = 'inbox.auto_assigned' and details->>'engineMessageId' like 'fb-b-%'`,
          )
        )[0].details.via,
      ).toBe('other_responder');
      // No responders configured at all: the same fallback (everyone who may reply shares the work).
      await resetWork();
      put(message('fb-n', 'fake-linkedin-1', at(0)));
      await sweepAt(10);
      expect(['managerA', 'writerA', 'writer2A', 'writer3A', 'execA']).toContain(
        nameOf((await itemRow('fb-n')).assigned_to),
      );
    });

    it('with nobody who can reply, the message stays unassigned and the managers are told once', async () => {
      await resetWork();
      put(message('d-1', 'fake-youtube-d', at(0)));
      await sweepAt(10);
      await sweepAt(10);
      await sweepAt(20);
      const row = await itemRow('d-1');
      expect(row.assigned_to).toBeNull();
      expect(row.assigned_automatically).toBe(false);
      // The people who manage the inbox of company D (its administrator, the group administrator) hear once.
      const told = await notes('adminD', 'inbox.escalated');
      expect(told).toHaveLength(1);
      expect(told[0]!.summary).toContain('nobody to answer');
      expect(await notes('groupAdmin', 'inbox.escalated')).toHaveLength(1);
      // Recorded as level 6 of kind inbox, which is not a miss of the monthly report (that is level 3).
      expect(await events('d-1')).toEqual([6]);
      const misses = await json(
        await send('GET', `/api/reports/inbox-misses?companyId=${companyD}`, 'groupAdmin'),
      );
      expect(misses).toEqual([]);
      expect(
        await query(
          `select 1 from audit_events where action = 'inbox.auto_assigned' and details->>'engineMessageId' = 'd-1'`,
        ),
      ).toHaveLength(0);
      // Nobody of company A or B is told about company D.
      for (const outsider of ['managerA', 'managerB', 'creatorB'])
        expect(await notes(outsider, 'inbox.escalated')).toEqual([]);
      // When someone who can reply arrives, the next sweep gives it to them (and the manager is not told again).
      const writerD = (
        await query(
          `insert into users (idp_subject, email, display_name) values ('sub-writerD', 'writerD@example.test', 'sub-writerD') returning id`,
        )
      )[0].id as string;
      await query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'content_creator')`,
        [writerD, f.groupId, companyD],
      );
      await sweepAt(30);
      expect((await itemRow('d-1')).assigned_to).toBe(writerD);
      expect(await notes('adminD', 'inbox.escalated')).toHaveLength(1);
      await query(`delete from notifications where recipient_user_id = $1`, [writerD]);
      await query(`delete from memberships where user_id = $1`, [writerD]);
      await query(`delete from audit_events where actor_user_id = $1`, [writerD]);
    });

    it('never reassigns: an assigned message, a cleared one and an answered one are left alone; running the sweep twice changes nothing', async () => {
      await resetWork();
      await setResponders('managerA', f.companyA, [
        { user: 'writerA', kind: 'primary', languages: ['en'] },
      ]);
      put(
        message('n-assigned', 'fake-linkedin-1', at(0)),
        message('n-cleared', 'fake-linkedin-1', at(0)),
        message('n-answered', 'fake-linkedin-1', at(0)),
        message('n-engine', 'fake-linkedin-1', at(0), { replied: true }),
      );
      expect((await assign('managerA', 'n-assigned', 'execA')).status).toBe(200);
      expect((await assign('managerA', 'n-cleared', 'execA')).status).toBe(200);
      expect((await assign('managerA', 'n-cleared', null)).status).toBe(200);
      // A reply sent through DCC marks the row answered.
      await query(
        `insert into inbox_items (company_id, social_account_id, engine_message_id, received_at, first_response_at, first_response_by)
         values ($1, $2, 'n-answered', $3, now(), $4)`,
        [f.companyA, f.accountA, at(0), users.managerA],
      );
      await sweepAt(10);
      expect((await itemRow('n-assigned')).assigned_to).toBe(users.execA);
      expect((await itemRow('n-assigned')).assigned_automatically).toBe(false);
      expect((await itemRow('n-cleared')).assigned_to).toBeNull(); // a person cleared it on purpose
      expect((await itemRow('n-answered')).assigned_to).toBeNull();
      expect(await itemRow('n-engine')).toBeUndefined(); // answered in the engine: no row, nothing to route
      const audits = async () =>
        (await query(`select 1 from audit_events where action = 'inbox.auto_assigned'`)).length;
      const notifications = async () =>
        (await query(`select 1 from notifications where event_type = 'inbox.assigned'`)).length;
      const before = { audits: await audits(), notifications: await notifications() };
      await sweepAt(10);
      await sweepAt(11);
      expect({ audits: await audits(), notifications: await notifications() }).toEqual(before);
      // A message nobody has is given exactly once, however often the sweep runs.
      put(message('n-new', 'fake-linkedin-1', at(2)));
      await sweepAt(12);
      await sweepAt(12);
      await sweepAt(13);
      expect((await itemRow('n-new')).assigned_to).toBe(users.writerA);
      expect(await audits()).toBe(before.audits + 1);
      expect(await notifications()).toBe(before.notifications + 1);
      // The cleared message can be claimed by a person.
      expect((await claim('writer2A', 'n-cleared')).status).toBe(200);
      expect((await itemRow('n-cleared')).assigned_to).toBe(users.writer2A);
    });

    it('only touches the last seven days and never another company', async () => {
      await resetWork();
      put(
        message('old-1', 'fake-linkedin-1', new Date(BASE - 3 * DAY)),
        message('b-1', 'fake-facebook-1', at(0)),
      );
      await sweepAt(10);
      // Three days old: inside the window.
      expect((await itemRow('old-1')).assigned_to).not.toBeNull();
      const b = await itemRow('b-1');
      expect(b.company_id).toBe(f.companyB);
      expect([users.managerB, f.users.creatorB]).toContain(b.assigned_to);
      await resetWork();
      put(message('old-2', 'fake-linkedin-1', at(0)));
      await sweepAt(8 * 24 * 60);
      expect(await itemRow('old-2')).toBeUndefined();
    });
  });

  describe('claim (E-03)', () => {
    it('takes an unassigned message for the caller, audited as an assignment by the caller', async () => {
      await resetWork();
      put(message('c-1', 'fake-linkedin-1', at(0)));
      const r = await claim('writerA', 'c-1');
      expect(r.status).toBe(200);
      expect(await json(r)).toMatchObject({
        socialAccountId: f.accountA,
        engineMessageId: 'c-1',
        assignedTo: users.writerA,
        assignedToName: 'sub-writerA',
      });
      expect(await itemRow('c-1')).toMatchObject({
        assigned_to: users.writerA,
        assigned_by: users.writerA,
        assigned_automatically: false,
        reassignment_count: 0,
      });
      const audit = await query(
        `select actor_user_id, details from audit_events where action = 'inbox.assigned' and details->>'engineMessageId' = 'c-1'`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].actor_user_id).toBe(users.writerA);
      expect(audit[0].details).toMatchObject({ claimed: true, assignedTo: users.writerA });
      // Claiming what you already hold changes and audits nothing.
      expect((await claim('writerA', 'c-1')).status).toBe(200);
      expect(
        await query(
          `select 1 from audit_events where action = 'inbox.assigned' and details->>'engineMessageId' = 'c-1'`,
        ),
      ).toHaveLength(1);
      // The manager, the executive and the writer may all claim; nobody is told about their own claim.
      expect(await notes('writerA', 'inbox.assigned')).toEqual([]);
    });

    it('answers 409 when someone has the message already (a person or the system), or it was answered', async () => {
      await resetWork();
      put(
        message('c-taken', 'fake-linkedin-1', at(0)),
        message('c-auto', 'fake-linkedin-1', at(0)),
        message('c-done', 'fake-linkedin-1', at(0)),
        message('c-engine', 'fake-linkedin-1', at(0), { replied: true }),
      );
      expect((await assign('managerA', 'c-taken', 'writer2A')).status).toBe(200);
      const r = await claim('writerA', 'c-taken');
      expect(r.status).toBe(409);
      expect((await json(r)).message).toContain('already');
      expect((await itemRow('c-taken')).assigned_to).toBe(users.writer2A);
      await setResponders('managerA', f.companyA, [
        { user: 'writer3A', kind: 'primary', languages: ['en'] },
      ]);
      await sweepAt(10);
      expect((await itemRow('c-auto')).assigned_to).toBe(users.writer3A);
      expect((await claim('writerA', 'c-auto')).status).toBe(409);
      // Answered through DCC, or already answered in the engine.
      await query(
        `update inbox_items set assigned_to = null, assigned_by = null, assigned_at = null, first_response_at = now(), first_response_by = $1 where engine_message_id = 'c-done'`,
        [users.managerA],
      );
      expect((await claim('writerA', 'c-done')).status).toBe(409);
      expect((await claim('writerA', 'c-engine')).status).toBe(409);
      // Of two people claiming the same free message, exactly one wins.
      put(message('c-race', 'fake-linkedin-1', at(0)));
      const results = await Promise.all([claim('writerA', 'c-race'), claim('writer2A', 'c-race')]);
      expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    });

    it('is refused to people who cannot reply, to another company, and for a message that does not exist', async () => {
      await resetWork();
      put(message('c-w', 'fake-linkedin-1', at(0)));
      expect((await claim('adminA', 'c-w')).status).toBe(403); // manages, cannot reply
      expect((await claim('auditorA', 'c-w')).status).toBe(403);
      expect((await claim('groupAdmin', 'c-w')).status).toBe(403);
      expect((await claim('managerB', 'c-w')).status).toBe(404); // company B's manager, company A's account
      expect((await claim('creatorB', 'c-w')).status).toBe(404);
      expect((await claim('otherGroupAdmin', 'c-w')).status).toBe(403);
      expect((await claim('writerA', 'no-such-message')).status).toBe(404);
      // A message of company B's channel named on company A's account.
      put(message('c-b', 'fake-facebook-1', at(0)));
      expect((await claim('writerA', 'c-b')).status).toBe(404);
      expect(
        (await send('POST', '/api/inbox/claim', 'writerA', { engineMessageId: 'c-w' })).status,
      ).toBe(400);
      expect(
        (
          await send('POST', '/api/inbox/claim', 'writerA', {
            socialAccountId: 'not-an-id',
            engineMessageId: 'c-w',
          })
        ).status,
      ).toBe(400);
      expect(await itemRow('c-w')).toBeUndefined();
      expect(await itemRow('c-b')).toBeUndefined();
    });

    it('claiming by a person who was handed a cleared message counts like any other assignment of it', async () => {
      await resetWork();
      put(message('c-re', 'fake-linkedin-1', at(0)));
      expect((await assign('managerA', 'c-re', 'writerA')).status).toBe(200);
      expect((await assign('managerA', 'c-re', null)).status).toBe(200);
      expect((await claim('writer2A', 'c-re')).status).toBe(200);
      // Clear and assign again is a reassignment (the same rule as the manual route); the due time never moved.
      expect((await itemRow('c-re')).reassignment_count).toBe(1);
      expect(find(await listFor('managerA'), 'c-re').dueAt).toBe(at(240).toISOString());
    });
  });

  describe('the backup responder at 150% (E-06)', () => {
    it('prefers a backup of the message language with the fewest open messages, then the Round 2 rule', async () => {
      await resetWork();
      await setResponders('managerA', f.companyA, [
        { user: 'writer3A', kind: 'backup', languages: ['en'] },
        { user: 'writer2A', kind: 'backup', languages: ['am'] },
      ]);
      // writer3A holds 2 open messages, everyone else none: the Round 2 rule alone would pick someone else.
      await loadUp('writer3A', 2, 'b');
      put(
        message('bk-en', 'fake-linkedin-1', at(0), { text: 'English question' }),
        message('bk-am', 'fake-linkedin-1', at(0), { text: AMHARIC }),
      );
      expect((await assign('managerA', 'bk-en', 'writerA')).status).toBe(200);
      expect((await assign('managerA', 'bk-am', 'writerA')).status).toBe(200);
      await sweepAt(359);
      await sweepAt(360);
      await sweepAt(360);
      expect(await events('bk-en')).toEqual([1, 2]);
      const en = await itemRow('bk-en');
      expect(en.assigned_to).toBe(users.writer3A);
      expect(en.assigned_by).toBeNull();
      expect(en.assigned_automatically).toBe(true);
      expect(en.reassignment_count).toBe(0);
      expect((await itemRow('bk-am')).assigned_to).toBe(users.writer2A);
      expect(
        (await notes('writer3A', 'inbox.escalated')).map((n) => n.summary).join('|'),
      ).toContain('handed to you');
      const audit = await query(
        `select details from audit_events where action = 'inbox.escalated' and details->>'engineMessageId' = 'bk-en' and details->>'level' = '2'`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].details).toMatchObject({ movedTo: users.writer3A, backupResponder: true });
      // The due time stayed with the arrival.
      expect(find(await listFor('managerA'), 'bk-en').dueAt).toBe(at(240).toISOString());
    });

    it('falls back to the old rule when no backup answers the language, or the backup lost the permission', async () => {
      await resetWork();
      // Only an Amharic backup, and she is busy: an English message does not go to her.
      await setResponders('managerA', f.companyA, [
        { user: 'writer2A', kind: 'backup', languages: ['am'] },
      ]);
      await loadUp('writer2A', 3, 'c');
      put(message('bk-fb', 'fake-linkedin-1', at(0), { text: 'English question' }));
      expect((await assign('managerA', 'bk-fb', 'writerA')).status).toBe(200);
      await sweepAt(360);
      expect(await events('bk-fb')).toEqual([1, 2]);
      const moved = (await itemRow('bk-fb')).assigned_to;
      expect(moved).not.toBe(users.writer2A);
      expect(moved).not.toBe(users.writerA);
      expect(moved).not.toBeNull();
      // A backup who lost `inbox.reply` is ignored.
      await resetWork();
      await setResponders('managerA', f.companyA, [
        { user: 'writer3A', kind: 'backup', languages: ['en', 'am'] },
      ]);
      await query(`update memberships set role = 'auditor' where user_id = $1`, [users.writer3A]);
      try {
        put(message('bk-lost', 'fake-linkedin-1', at(0)));
        expect((await assign('managerA', 'bk-lost', 'writerA')).status).toBe(200);
        await sweepAt(360);
        expect((await itemRow('bk-lost')).assigned_to).not.toBe(users.writer3A);
        expect((await itemRow('bk-lost')).assigned_to).not.toBe(users.writerA);
        expect((await itemRow('bk-lost')).assigned_to).not.toBeNull();
      } finally {
        await query(`update memberships set role = 'content_creator' where user_id = $1`, [
          users.writer3A,
        ]);
      }
    });

    it('never picks the current assignee, even when they are the only backup', async () => {
      await resetWork();
      await setResponders('managerA', f.companyA, [
        { user: 'writerA', kind: 'backup', languages: ['en', 'am'] },
      ]);
      put(message('bk-self', 'fake-linkedin-1', at(0)));
      expect((await assign('managerA', 'bk-self', 'writerA')).status).toBe(200);
      await sweepAt(360);
      const moved = (await itemRow('bk-self')).assigned_to;
      expect(moved).not.toBe(users.writerA);
      expect(moved).not.toBeNull();
    });
  });
});

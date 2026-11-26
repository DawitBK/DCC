import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InboxAckService } from '../src/modules/publishing/inbox-ack.service';
import { SweepService } from '../src/modules/working-hours/sweep.service';
import { startHarness, type Harness } from './replies-harness';

/**
 * Round 2, E-13 (RQ-033): the automatic acknowledgement. No effect until a DIFFERENT person who holds content.approve
 * approves exactly that text; any edit clears the approval; sent only for a message that arrived outside working hours,
 * once, never as the first response, never while frozen; Amharic only for Ethiopic text.
 */
describe('automatic acknowledgement outside working hours (E-13)', () => {
  let h: Harness;

  // The next Sunday at least two days ahead, as the stage for the sweep (Mon-Sat 08:30-17:30, UTC+3).
  const sunday = (() => {
    const d = new Date();
    d.setUTCHours(12, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 2);
    while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  })();
  const at = (days: number, hours: number, minutes = 0) => {
    const d = new Date(sunday);
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(hours, minutes, 0, 0);
    return d;
  };
  const SUNDAY_NOON = at(0, 12); // 15:00 local, Sunday: outside working hours
  const MONDAY_MORNING = at(1, 6); // 09:00 local, Monday: inside working hours
  const SWEEP_NOW = at(1, 7); // Monday 10:00 local
  const TEXT_EN = 'Thank you. Our team answers during working hours, Monday to Saturday.';
  const TEXT_AM = 'አመሰግናለሁ። ቡድናችን በሥራ ሰዓት ይመልሳል።';

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.stop();
  });

  const put = (who: string, over: Record<string, unknown> = {}, companyId = h.f.companyA) =>
    h.send('PUT', '/api/inbox/acknowledgement', who, {
      companyId,
      textEn: TEXT_EN,
      textAm: TEXT_AM,
      enabled: true,
      ...over,
    });
  const get = async (who: string, companyId = h.f.companyA) =>
    h.json(await h.send('GET', `/api/inbox/acknowledgement?companyId=${companyId}`, who));
  const approve = (who: string, version: number, companyId = h.f.companyA) =>
    h.send('POST', '/api/inbox/acknowledgement/approve', who, { companyId, version });
  const sweep = () => h.app.get(SweepService).runOnce(SWEEP_NOW);
  const acksOf = (id: string) =>
    h.query(`select * from inbox_acknowledgements where engine_message_id = $1`, [id]);
  const repliesTo = (id: string) => h.fake.replies.filter((r) => r.engineMessageId === id);

  describe('the text and its approval', () => {
    it('nothing is set at first; only someone who manages the inbox can write it', async () => {
      expect(await get('mgrA')).toMatchObject({ textEn: null, active: false, version: 0 });
      expect((await put('writerA')).status).toBe(403); // reads and replies, does not manage
      expect((await put('auditorA')).status).toBe(403);
      expect((await put('mgrB')).status).toBe(404); // another company
      expect((await put('mgrA', { textEn: '   ' })).status).toBe(400);
      expect((await put('mgrA', { textAm: '' })).status).toBe(400);
    });

    it('a written text has no effect until approved: the sweep sends nothing', async () => {
      const written = await put('mgrA');
      expect(written.status).toBe(200);
      expect(await h.json(written)).toMatchObject({
        textEn: TEXT_EN,
        textAm: TEXT_AM,
        version: 1,
        approvedBy: null,
        active: false,
        canApprove: false, // the writer
      });
      h.addMessage('msg-unapproved', { receivedAt: SUNDAY_NOON });
      expect(await sweep()).toEqual([]);
      expect(repliesTo('msg-unapproved')).toEqual([]);
      expect(await acksOf('msg-unapproved')).toHaveLength(0);
    });

    it('the person who wrote the text cannot approve it; a different approver can; a stale version is refused', async () => {
      const own = await approve('mgrA', 1);
      expect(own.status).toBe(403);
      expect((await h.json(own)).message).toMatch(/cannot approve it/);
      expect((await approve('writerA', 1)).status).toBe(403); // no content.approve
      expect((await approve('adminA', 1)).status).toBe(403);
      expect((await approve('mgrB', 1)).status).toBe(404); // another company
      expect((await approve('execA', 7)).status).toBe(409); // not the version on the screen
      expect((await get('execA')).canApprove).toBe(true);
      const ok = await approve('execA', 1);
      expect(ok.status).toBe(200);
      expect(await h.json(ok)).toMatchObject({
        approvedBy: h.people.execA,
        approvedByName: 'execA',
        active: true,
      });
      expect((await approve('exec2A', 1)).status).toBe(409); // already approved
      const events = await h.query(
        `select details->>'event' as event from audit_events where action = 'inbox.ack_settings_set' and company_id = $1 order by id`,
        [h.f.companyA],
      );
      expect(events.map((e) => e.event)).toEqual(['created', 'approved']);
    });

    it('the database also refuses an approval by the person who wrote the text', async () => {
      await expect(
        h.query(
          `update inbox_ack_settings set approved_by = set_by, approved_at = now() where company_id = $1`,
          [h.f.companyA],
        ),
      ).rejects.toThrow(/check/);
    });
  });

  describe('sending', () => {
    it('acknowledges a message that arrived outside working hours, in the right language, and records it', async () => {
      h.addMessage('msg-sun-en', { receivedAt: SUNDAY_NOON });
      h.addMessage('msg-sun-am', { receivedAt: at(0, 13), text: 'ሰላም፣ ዋጋው ስንት ነው?' });
      h.addMessage('msg-sat-dawn', { receivedAt: at(-1, 3) }); // Saturday 06:00 local, before the day starts
      h.addMessage('msg-night', { receivedAt: at(0, 18, 30) }); // Sunday evening
      expect(await sweep()).toEqual([]);
      expect(repliesTo('msg-sun-en')).toEqual([{ engineMessageId: 'msg-sun-en', text: TEXT_EN }]);
      expect(repliesTo('msg-sun-am')).toEqual([{ engineMessageId: 'msg-sun-am', text: TEXT_AM }]);
      expect(repliesTo('msg-sat-dawn')).toHaveLength(1);
      expect(repliesTo('msg-night')).toHaveLength(1);
      const ack = (await acksOf('msg-sun-am'))[0];
      expect(ack).toMatchObject({ language: 'am', company_id: h.f.companyA });
      expect(ack.acked_at).not.toBeNull();
      const audits = await h.query(
        `select details from audit_events where action = 'inbox.ack_sent' and details->>'engineMessageId' = 'msg-sun-am'`,
      );
      expect(audits).toHaveLength(1);
      expect(audits[0].details).toMatchObject({ language: 'am', firstResponse: false });
    });

    it('a message that arrived inside working hours is not acknowledged', async () => {
      h.addMessage('msg-mon', { receivedAt: MONDAY_MORNING });
      await sweep();
      expect(repliesTo('msg-mon')).toEqual([]);
      expect(await acksOf('msg-mon')).toHaveLength(0);
    });

    it('is never the first response: no response time starts or stops, and the message still shows as unanswered', async () => {
      expect(
        await h.query(
          `select * from inbox_items where engine_message_id = 'msg-sun-en' and first_response_at is not null`,
        ),
      ).toHaveLength(0);
      const list = await h.json(
        await h.send(
          'GET',
          `/api/inbox?companyId=${h.f.companyA}&to=${encodeURIComponent(SWEEP_NOW.toISOString())}`,
          'mgrA',
        ),
      );
      const row = list.find((m: any) => m.engineMessageId === 'msg-sun-en');
      expect(row).toMatchObject({ replied: false, firstResponseAt: null });
    });

    it("a person's real reply after the acknowledgement is the first response, and it counts normally", async () => {
      // A message of this very moment, made 'outside working hours' by a calendar whose only working day is tomorrow.
      const tomorrow = (new Date(Date.now() + 3 * 3_600_000).getUTCDay() + 1) % 7;
      await h.query(
        `insert into company_working_hours (company_id, work_days, updated_by) values ($1, $2, $3)`,
        [h.f.companyA, [tomorrow], h.people.groupAdmin],
      );
      try {
        const approvedAt: Date = (await h.query(`select approved_at from inbox_ack_settings`))[0]
          .approved_at;
        await new Promise((done) => setTimeout(done, 20));
        h.addMessage('msg-real', {
          receivedAt: new Date(Math.max(approvedAt.getTime() + 1, Date.now() - 5)),
        });
        await h.app.get(InboxAckService).acknowledge(h.f.companyA, new Date());
        expect(repliesTo('msg-real')).toEqual([{ engineMessageId: 'msg-real', text: TEXT_EN }]);
        const listed = async () =>
          (await h.json(await h.send('GET', `/api/inbox?companyId=${h.f.companyA}`, 'mgrA'))).find(
            (m: any) => m.engineMessageId === 'msg-real',
          );
        expect(await listed()).toMatchObject({ replied: false, firstResponseAt: null });
        const r = await h.send('POST', '/api/inbox/reply', 'mgrA', {
          socialAccountId: h.f.accountA,
          engineMessageId: 'msg-real',
          text: 'Here is the price list.',
        });
        expect(r.status).toBe(201);
        const after = await listed();
        expect(after).toMatchObject({ replied: true });
        expect(after.firstResponseAt).not.toBeNull();
        expect(
          (
            await h.query(
              `select first_response_by from inbox_items where engine_message_id = 'msg-real'`,
            )
          )[0].first_response_by,
        ).toBe(h.people.mgrA);
      } finally {
        await h.query(`delete from company_working_hours where company_id = $1`, [h.f.companyA]);
      }
    });

    it('is sent once per message, however often the sweep runs or the engine forgets that it was answered', async () => {
      const before = h.fake.replies.length;
      await sweep();
      await sweep();
      expect(h.fake.replies.length).toBe(before);
      // Even if the engine reports the message as unanswered again, the claim row stops a second send.
      for (const m of h.fake.inboxMessages)
        if (m.engineMessageId === 'msg-night') m.replied = false;
      await sweep();
      expect(repliesTo('msg-night')).toHaveLength(1);
      expect(await acksOf('msg-night')).toHaveLength(1);
    });

    it('does not acknowledge a message that was answered, in the engine or through DCC', async () => {
      h.addMessage('msg-answered-engine', { receivedAt: at(0, 14), replied: true });
      h.addMessage('msg-answered-dcc', { receivedAt: at(0, 15) });
      await h.query(
        `insert into inbox_items (company_id, social_account_id, engine_message_id, received_at, first_response_at, first_response_by)
         values ($1, $2, 'msg-answered-dcc', $3, now(), $4)`,
        [h.f.companyA, h.f.accountA, at(0, 15), h.people.mgrA],
      );
      await sweep();
      expect(repliesTo('msg-answered-engine')).toEqual([]);
      expect(repliesTo('msg-answered-dcc')).toEqual([]);
    });

    it('does not answer the backlog from before the approval', async () => {
      const approvedAt: Date = (await h.query(`select approved_at from inbox_ack_settings`))[0]
        .approved_at;
      h.addMessage('msg-old', { receivedAt: new Date(approvedAt.getTime() - 3_600_000) });
      await sweep();
      expect(repliesTo('msg-old')).toEqual([]);
    });

    it('never sends while the company is frozen; sends after the freeze ends', async () => {
      await h.query(
        `insert into publishing_freezes (company_id, frozen_by, reason) values ($1, $2, 'test')`,
        [h.f.companyA, h.people.groupAdmin],
      );
      h.addMessage('msg-frozen', { receivedAt: at(0, 16) });
      try {
        await sweep();
        expect(repliesTo('msg-frozen')).toEqual([]);
        expect(await acksOf('msg-frozen')).toHaveLength(0);
      } finally {
        await h.query(`delete from publishing_freezes where company_id = $1`, [h.f.companyA]);
      }
      await sweep();
      expect(repliesTo('msg-frozen')).toHaveLength(1);
    });

    it('a failed send is released and tried again by the next sweep', async () => {
      h.addMessage('msg-retry', { receivedAt: at(0, 17) });
      const original = h.fake.replyToMessage.bind(h.fake);
      h.fake.replyToMessage = async () => {
        throw new Error('network down');
      };
      try {
        expect(await sweep()).toEqual([]);
      } finally {
        h.fake.replyToMessage = original;
      }
      expect(repliesTo('msg-retry')).toEqual([]);
      expect(await acksOf('msg-retry')).toHaveLength(0);
      await sweep();
      expect(repliesTo('msg-retry')).toHaveLength(1);
    });

    it('can be switched off without losing the approval', async () => {
      const off = await put('mgrA', { enabled: false });
      expect(await h.json(off)).toMatchObject({ enabled: false, active: false });
      expect((await get('mgrA')).approvedBy).toBe(h.people.execA);
      h.addMessage('msg-off', { receivedAt: at(0, 19) });
      await sweep();
      expect(repliesTo('msg-off')).toEqual([]);
      expect(await h.json(await put('mgrA', { enabled: true }))).toMatchObject({ active: true });
      await sweep();
      expect(repliesTo('msg-off')).toHaveLength(1);
    });
  });

  describe('editing', () => {
    it('any edit of a text clears the approval, and nothing is sent until a different person approves the new text', async () => {
      const edited = await put('exec2A', { textEn: `${TEXT_EN} Thank you for your patience.` });
      expect(await h.json(edited)).toMatchObject({
        version: 2,
        approvedBy: null,
        active: false,
        setBy: h.people.exec2A,
      });
      h.addMessage('msg-after-edit', { receivedAt: at(0, 20) });
      await sweep();
      expect(repliesTo('msg-after-edit')).toEqual([]);
      // The editor cannot approve their own words; the old approver (version 1) is not enough for version 2.
      expect((await approve('exec2A', 2)).status).toBe(403);
      expect((await approve('execA', 1)).status).toBe(409);
      expect((await approve('execA', 2)).status).toBe(200);
      await sweep();
      expect(repliesTo('msg-after-edit')).toEqual([
        { engineMessageId: 'msg-after-edit', text: `${TEXT_EN} Thank you for your patience.` },
      ]);
      const events = await h.query(
        `select details from audit_events where action = 'inbox.ack_settings_set' and details->>'event' = 'edited'`,
      );
      expect(events[0].details).toMatchObject({ approvalCleared: true, version: 2 });
    });

    it('editing only the Amharic text also clears the approval; saving the same text again changes nothing', async () => {
      const same = await h.json(
        await put('mgrA', { textEn: `${TEXT_EN} Thank you for your patience.` }),
      );
      expect(same.version).toBe(2);
      expect(same.approvedBy).toBe(h.people.execA);
      const edited = await h.json(
        await put('mgrA', {
          textEn: `${TEXT_EN} Thank you for your patience.`,
          textAm: `${TEXT_AM} እናመሰግናለን።`,
        }),
      );
      expect(edited).toMatchObject({ version: 3, approvedBy: null, active: false });
    });

    it('without an Amharic text the English one is used for Ethiopic messages too', async () => {
      await put('exec2A', { textEn: TEXT_EN, textAm: null });
      expect((await approve('execA', 4)).status).toBe(200);
      h.addMessage('msg-am-only-en', { receivedAt: at(0, 21), text: 'ሰላም' });
      await sweep();
      expect(repliesTo('msg-am-only-en')).toEqual([
        { engineMessageId: 'msg-am-only-en', text: TEXT_EN },
      ]);
    });
  });

  describe("another company's people (attack tests)", () => {
    it("cannot read, write or approve company A's text, and company A's text is never sent on company B's account", async () => {
      expect(
        (await h.send('GET', `/api/inbox/acknowledgement?companyId=${h.f.companyA}`, 'mgrB'))
          .status,
      ).toBe(404);
      expect((await put('mgrB', { textEn: 'Hijacked' })).status).toBe(404);
      expect((await approve('mgrB', 4)).status).toBe(404);
      expect((await get('mgrA')).textEn).toBe(TEXT_EN);
      h.addMessage('msg-b-sunday', { channel: 'fake-facebook-1', receivedAt: at(0, 12) });
      await sweep();
      expect(repliesTo('msg-b-sunday')).toEqual([]);
      expect(await get('mgrB', h.f.companyB)).toMatchObject({ textEn: null, active: false });
    });

    it('row-level security hides the rows and refuses writes into the other company', async () => {
      const { createDatabase } = await import('../src/platform/database/database');
      const { appUrl } = await import('./helpers');
      const { TenantDb } = await import('../src/platform/tenancy/tenant-db');
      const db = createDatabase(appUrl(), 1);
      try {
        const tenant = new TenantDb(db);
        const asB = { userId: h.people.mgrB, groupIds: [], companyIds: [h.f.companyB] };
        const seen = await tenant.run(asB, async (trx) => ({
          settings: await trx.selectFrom('inbox_ack_settings').selectAll().execute(),
          acks: await trx.selectFrom('inbox_acknowledgements').selectAll().execute(),
        }));
        expect(seen.settings).toEqual([]);
        expect(seen.acks).toEqual([]);
        await expect(
          tenant.run(asB, (trx) =>
            trx
              .updateTable('inbox_ack_settings')
              .set({ text_en: 'Hijacked' })
              .where('company_id', '=', h.f.companyA)
              .execute()
              .then((r) => {
                if (r[0]!.numUpdatedRows === 0n) throw new Error('no row');
              }),
          ),
        ).rejects.toThrow();
        await expect(
          tenant.run(asB, (trx) =>
            trx
              .insertInto('inbox_acknowledgements')
              .values({
                company_id: h.f.companyA,
                social_account_id: h.f.accountA,
                engine_message_id: 'x',
                received_at: new Date(),
                language: 'en',
              })
              .execute(),
          ),
        ).rejects.toThrow();
      } finally {
        await db.close();
      }
    });
  });

  it('the service is also callable directly with a time of the caller (what the sweep does)', async () => {
    h.addMessage('msg-direct', { receivedAt: at(0, 22) });
    await h.app.get(InboxAckService).acknowledge(h.f.companyA, SWEEP_NOW);
    expect(repliesTo('msg-direct')).toHaveLength(1);
  });
});

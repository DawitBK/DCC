import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SweepService } from '../src/modules/working-hours/sweep.service';
import { MINUTE, startHarness, type Harness } from './replies-harness';

/**
 * Round 2, E-08 (RQ-032): sensitive replies are approved before they are sent.
 * Every state of a request: pending, partial approval, approved and sent, rejected, engine failure; the writer cannot
 * decide; another company sees nothing; a frozen company refuses; the ladder reminds once per level.
 */
describe('approval of sensitive replies (E-08)', () => {
  let h: Harness;
  let n = 0;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.stop();
  });

  /** A fresh message in company A's channel, and the ask for approval of a sensitive reply to it. */
  const ask = async (
    who = 'writerA',
    over: Record<string, unknown> = {},
  ): Promise<{ id: string; messageId: string; status: number; body: any }> => {
    n += 1;
    const messageId = `msg-r-${n}`;
    h.addMessage(messageId);
    const r = await h.send('POST', '/api/inbox/reply-approvals', who, {
      socialAccountId: h.f.accountA,
      engineMessageId: messageId,
      text: `We are looking into message ${n}.`,
      kind: 'media',
      ...over,
    });
    const body = await h.json(r);
    return { id: body.id, messageId, status: r.status, body };
  };
  const approve = (who: string, id: string, comment?: string) =>
    h.send('POST', `/api/inbox/reply-approvals/${id}/approve`, who, comment ? { comment } : {});
  const reject = (who: string, id: string, reason = 'The wording promises too much.') =>
    h.send('POST', `/api/inbox/reply-approvals/${id}/reject`, who, { reason });
  const rowOf = async (id: string) =>
    (await h.query(`select * from reply_approval_requests where id = $1`, [id]))[0];
  const audits = async (targetId: string) =>
    (
      await h.query(`select action from audit_events where target_id = $1 order by id`, [targetId])
    ).map((r) => r.action as string);
  const notificationsFor = async (userName: string, eventType: string, targetId?: string) =>
    h.query(
      `select * from notifications where recipient_user_id = $1 and event_type = $2 ${
        targetId ? 'and target_id = $3' : ''
      }`,
      targetId ? [h.people[userName], eventType, targetId] : [h.people[userName], eventType],
    );
  const setPolicy = async (categoryKey: string, required: number, roles: string[] = []) => {
    const cat =
      (
        await h.query(
          `insert into content_categories (group_id, key, name) values ($1, $2, $2)
         on conflict do nothing returning id`,
          [h.f.groupId, categoryKey],
        )
      )[0] ?? (await h.query(`select id from content_categories where key = $1`, [categoryKey]))[0];
    await h.query(`delete from approval_policies where company_id = $1 and category_id = $2`, [
      h.f.companyA,
      cat.id,
    ]);
    await h.query(
      `insert into approval_policies (company_id, category_id, required_approvals, approver_roles, updated_by)
       values ($1, $2, $3, $4, $5)`,
      [h.f.companyA, cat.id, required, roles, h.people.groupAdmin],
    );
  };
  const clearPolicies = () => h.query(`delete from approval_policies`);

  describe('asking', () => {
    it('a flagged reply is NOT sent: it becomes a pending request that keeps the text, the kind and the writer', async () => {
      const r = await ask();
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        status: 'pending',
        kind: 'media',
        categoryKey: 'crisis',
        requiredApprovals: 1,
        approvals: 0,
        writtenBy: h.people.writerA,
        companyId: h.f.companyA,
        canDecide: false, // the writer
      });
      expect(r.body.text).toContain('looking into');
      expect(h.fake.replies.filter((x) => x.engineMessageId === r.messageId)).toEqual([]);
      expect(await audits(r.id)).toEqual(['inbox.reply_approval_requested']);
      // Due four working hours after the request, by the company calendar.
      expect(new Date(r.body.dueAt).getTime()).toBeGreaterThan(
        new Date(r.body.requestedAt).getTime(),
      );
    });

    it('the approvers are told, the writer is not', async () => {
      const r = await ask();
      for (const who of ['mgrA', 'execA', 'exec2A', 'groupMkt'])
        expect(await notificationsFor(who, 'inbox.reply_requested', r.id), who).toHaveLength(1);
      expect(await notificationsFor('writerA', 'inbox.reply_requested', r.id)).toHaveLength(0);
      expect(await notificationsFor('mgrB', 'inbox.reply_requested', r.id)).toHaveLength(0);
    });

    it('a second request for the same message while one is open is a conflict', async () => {
      const r = await ask();
      const again = await h.send('POST', '/api/inbox/reply-approvals', 'writerA', {
        socialAccountId: h.f.accountA,
        engineMessageId: r.messageId,
        text: 'Another try.',
        kind: 'media',
      });
      expect(again.status).toBe(409);
    });

    it('needs a real kind, a text and a message of this account; a person who cannot reply cannot ask', async () => {
      const base = {
        socialAccountId: h.f.accountA,
        engineMessageId: 'msg-r-bad',
        text: 'Hello',
        kind: 'media',
      };
      expect(
        (await h.send('POST', '/api/inbox/reply-approvals', 'writerA', { ...base, kind: 'gossip' }))
          .status,
      ).toBe(400);
      expect(
        (await h.send('POST', '/api/inbox/reply-approvals', 'writerA', { ...base, text: '  ' }))
          .status,
      ).toBe(400);
      // Unknown message id on this account.
      expect((await h.send('POST', '/api/inbox/reply-approvals', 'writerA', base)).status).toBe(
        404,
      );
      // Company admin reads the inbox settings but cannot reply (no inbox.reply): refused by permission.
      h.addMessage('msg-r-bad');
      expect((await h.send('POST', '/api/inbox/reply-approvals', 'adminA', base)).status).toBe(403);
    });

    it('a non-flagged reply keeps working exactly as before for the Content Writer', async () => {
      h.addMessage('msg-plain-1');
      const r = await h.send('POST', '/api/inbox/reply', 'writerA', {
        socialAccountId: h.f.accountA,
        engineMessageId: 'msg-plain-1',
        text: 'Thank you for your comment.',
      });
      expect(r.status).toBe(201);
      expect(h.fake.replies.some((x) => x.engineMessageId === 'msg-plain-1')).toBe(true);
    });
  });

  describe('deciding', () => {
    it('the writer can never approve or reject their own reply; a person who cannot approve cannot either', async () => {
      const r = await ask();
      const own = await approve('writerA', r.id);
      expect(own.status).toBe(403); // does not hold content.approve at all
      // Even a writer who DOES hold content.approve (a marketing manager who wrote it) is refused.
      const mgrAsk = await ask('mgrA');
      const self = await approve('mgrA', mgrAsk.id);
      expect(self.status).toBe(403);
      expect((await h.json(self)).message).toMatch(/wrote a reply/);
      expect((await reject('mgrA', mgrAsk.id)).status).toBe(403);
      expect((await approve('adminA', r.id)).status).toBe(403); // company admin: no content.approve
      expect((await approve('auditorA', r.id)).status).toBe(403);
      expect((await rowOf(r.id)).status).toBe('pending');
      expect(h.fake.replies.some((x) => x.engineMessageId === r.messageId)).toBe(false);
    });

    it('one approver is enough by default: it is sent, the response clock starts, the writer is told, all of it audited', async () => {
      await clearPolicies();
      const r = await ask();
      const a = await approve('mgrA', r.id, 'Wording is fine.');
      expect(a.status).toBe(200);
      const body = await h.json(a);
      expect(body).toMatchObject({ status: 'sent', approvals: 1 });
      expect(h.fake.replies).toContainEqual({
        engineMessageId: r.messageId,
        text: expect.stringContaining('looking into'),
      });
      const item = (
        await h.query(`select * from inbox_items where engine_message_id = $1`, [r.messageId])
      )[0];
      expect(item.first_response_at).not.toBeNull();
      expect(item.first_response_by).toBe(h.people.writerA); // the writer answered; the approver allowed it
      expect(await notificationsFor('writerA', 'inbox.reply_decided', r.id)).toHaveLength(1);
      expect(await audits(r.id)).toEqual([
        'inbox.reply_approval_requested',
        'inbox.reply_approval_decided',
      ]);
      const sent = await h.query(
        `select action from audit_events where details->>'replyApprovalId' = $1 order by id`,
        [r.id],
      );
      expect(sent.map((x) => x.action)).toEqual(['inbox.reply_requested', 'inbox.reply_sent']);
      // Already settled: a second decision is a conflict.
      expect((await approve('execA', r.id)).status).toBe(409);
      expect((await reject('execA', r.id)).status).toBe(409);
    });

    it('two approvals required by the policy: the first only counts, the second sends; the same person twice is refused', async () => {
      await clearPolicies();
      await setPolicy('legal', 2);
      const r = await ask('writerA', { kind: 'legal_threat' });
      expect(r.body).toMatchObject({ requiredApprovals: 2, categoryKey: 'legal' });
      const first = await h.json(await approve('mgrA', r.id));
      expect(first).toMatchObject({ status: 'pending', approvals: 1, canDecide: false });
      expect(h.fake.replies.some((x) => x.engineMessageId === r.messageId)).toBe(false);
      expect((await approve('mgrA', r.id)).status).toBe(409);
      const second = await h.json(await approve('execA', r.id));
      expect(second).toMatchObject({ status: 'sent', approvals: 2 });
      expect(h.fake.replies.filter((x) => x.engineMessageId === r.messageId)).toHaveLength(1);
      // personal_data follows the same category; media has no category here and needs one approver.
      const other = await ask('writerA', { kind: 'personal_data' });
      expect(other.body.requiredApprovals).toBe(2);
      const media = await ask('writerA', { kind: 'media' });
      expect(media.body.requiredApprovals).toBe(1);
      await clearPolicies();
    });

    it('the rule is copied when asked: a later change of the policy never moves a waiting request', async () => {
      await clearPolicies();
      await setPolicy('financial', 2);
      const r = await ask('writerA', { kind: 'refund_compensation' });
      await setPolicy('financial', 1);
      expect((await rowOf(r.id)).required_approvals).toBe(2);
      await clearPolicies();
    });

    it('a policy that names roles narrows who may decide', async () => {
      await clearPolicies();
      await setPolicy('crisis', 1, ['company_executive']);
      const r = await ask('writerA', { kind: 'safety' });
      const refused = await approve('mgrA', r.id);
      expect(refused.status).toBe(403);
      expect((await h.json(refused)).message).toMatch(/decided by/);
      expect((await approve('execA', r.id)).status).toBe(200);
      await clearPolicies();
    });

    it('a rejection needs a reason, is recorded, tells the writer, and the message can be asked again', async () => {
      const r = await ask();
      expect(
        (await h.send('POST', `/api/inbox/reply-approvals/${r.id}/reject`, 'mgrA', { reason: '' }))
          .status,
      ).toBe(400);
      const rejected = await reject('mgrA', r.id, 'Do not promise a date.');
      expect(rejected.status).toBe(200);
      expect(await h.json(rejected)).toMatchObject({
        status: 'rejected',
        settledReason: 'Do not promise a date.',
      });
      expect(await notificationsFor('writerA', 'inbox.reply_decided', r.id)).toHaveLength(1);
      expect(h.fake.replies.some((x) => x.engineMessageId === r.messageId)).toBe(false);
      expect(await audits(r.id)).toContain('inbox.reply_approval_decided');
      expect((await approve('execA', r.id)).status).toBe(409);
      const again = await h.send('POST', '/api/inbox/reply-approvals', 'writerA', {
        socialAccountId: h.f.accountA,
        engineMessageId: r.messageId,
        text: 'A better answer.',
        kind: 'media',
      });
      expect(again.status).toBe(201);
    });

    it('when the engine refuses, the request is marked failed with the reason, nothing is posted, the writer is told', async () => {
      const r = await ask();
      const spy = vi
        .spyOn(h.fake, 'replyToMessage')
        .mockRejectedValueOnce(new Error('The network said no.'));
      const res = await approve('mgrA', r.id);
      spy.mockRestore();
      expect(res.status).toBe(502);
      expect((await h.json(res)).message).toMatch(/could not be sent: The network said no\./);
      const row = await rowOf(r.id);
      expect(row.status).toBe('failed');
      expect(row.settled_reason).toBe('The network said no.');
      expect(h.fake.replies.some((x) => x.engineMessageId === r.messageId)).toBe(false);
      expect(
        (
          await h.query(`select * from inbox_items where engine_message_id = $1`, [r.messageId])
        ).filter((i) => i.first_response_at),
      ).toHaveLength(0);
      expect(await notificationsFor('writerA', 'inbox.reply_decided', r.id)).toHaveLength(1);
      const failed = await h.query(
        `select action from audit_events where details->>'replyApprovalId' = $1 order by id`,
        [r.id],
      );
      expect(failed.map((x) => x.action)).toEqual(['inbox.reply_requested', 'inbox.reply_failed']);
      // A failed request is final: it can be asked again as a new one.
      expect((await approve('execA', r.id)).status).toBe(409);
    });

    it('the first reply sent counts as the response: a normal reply first keeps its time, the approved one never moves it', async () => {
      const r = await ask();
      await h.send('POST', '/api/inbox/reply', 'mgrA', {
        socialAccountId: h.f.accountA,
        engineMessageId: r.messageId,
        text: 'We have seen this.',
      });
      const before = (
        await h.query(
          `select first_response_at, first_response_by from inbox_items where engine_message_id = $1`,
          [r.messageId],
        )
      )[0];
      expect((await approve('execA', r.id)).status).toBe(200);
      const after = (
        await h.query(
          `select first_response_at, first_response_by from inbox_items where engine_message_id = $1`,
          [r.messageId],
        )
      )[0];
      expect(after.first_response_at).toEqual(before.first_response_at);
      expect(after.first_response_by).toBe(h.people.mgrA);
    });
  });

  describe('reading', () => {
    it('an approver sees the request with the message being answered and may decide it; the writer sees it but may not', async () => {
      const r = await ask();
      const asApprover = (
        await h.json(await h.send('GET', '/api/inbox/reply-approvals?status=pending', 'execA'))
      ).find((x: any) => x.id === r.id);
      expect(asApprover).toMatchObject({
        canDecide: true,
        messageText: `Text of ${r.messageId}`,
        writtenByName: 'writerA',
      });
      const asWriter = (
        await h.json(await h.send('GET', '/api/inbox/reply-approvals', 'writerA'))
      ).find((x: any) => x.id === r.id);
      expect(asWriter.canDecide).toBe(false);
      const forMe = await h.json(
        await h.send('GET', '/api/inbox/reply-approvals?forMe=true', 'writerA'),
      );
      expect(forMe).toEqual([]);
      const forExec = await h.json(
        await h.send('GET', '/api/inbox/reply-approvals?forMe=true', 'execA'),
      );
      expect(forExec.some((x: any) => x.id === r.id)).toBe(true);
    });

    it('a person who only reads the company sees what they wrote, not other writers requests', async () => {
      const r = await ask('mgrA');
      // writerA cannot see mgrA's request (not an approver, did not write it).
      const seen = await h.json(await h.send('GET', '/api/inbox/reply-approvals', 'writerA'));
      expect(seen.some((x: any) => x.id === r.id)).toBe(false);
    });
  });

  describe("another company's people (attack tests)", () => {
    it('cannot see, approve, reject or ask for company A', async () => {
      const r = await ask();
      const listB = await h.json(await h.send('GET', '/api/inbox/reply-approvals', 'mgrB'));
      expect(listB.some((x: any) => x.id === r.id)).toBe(false);
      const filtered = await h.json(
        await h.send('GET', `/api/inbox/reply-approvals?companyId=${h.f.companyA}`, 'mgrB'),
      );
      expect(filtered).toEqual([]);
      expect((await approve('mgrB', r.id)).status).toBe(404);
      expect((await reject('mgrB', r.id)).status).toBe(404);
      const ask404 = await h.send('POST', '/api/inbox/reply-approvals', 'writerB', {
        socialAccountId: h.f.accountA,
        engineMessageId: r.messageId,
        text: 'Hello',
        kind: 'media',
      });
      expect(ask404.status).toBe(404);
      expect((await rowOf(r.id)).status).toBe('pending');
    });

    it('cannot read the rows straight from the database either (row-level security)', async () => {
      const r = await ask();
      const { createDatabase } = await import('../src/platform/database/database');
      const { appUrl } = await import('./helpers');
      const { TenantDb } = await import('../src/platform/tenancy/tenant-db');
      const db = createDatabase(appUrl(), 1);
      try {
        const tenant = new TenantDb(db);
        const asB = await tenant.run(
          { userId: h.people.mgrB, groupIds: [], companyIds: [h.f.companyB] },
          (trx) =>
            trx.selectFrom('reply_approval_requests').select('id').where('id', '=', r.id).execute(),
        );
        expect(asB).toEqual([]);
        await expect(
          tenant.run({ userId: h.people.mgrB, groupIds: [], companyIds: [h.f.companyB] }, (trx) =>
            trx
              .insertInto('reply_approval_decisions')
              .values({
                request_id: r.id,
                company_id: h.f.companyA,
                decided_by: h.people.mgrB,
                decision: 'approved',
                comment: null,
              })
              .execute(),
          ),
        ).rejects.toThrow();
      } finally {
        await db.close();
      }
    });
  });

  describe('a frozen company', () => {
    it('refuses to ask, and refuses to approve (the request stays waiting, nothing is recorded) until the freeze ends', async () => {
      const r = await ask();
      await h.query(
        `insert into publishing_freezes (company_id, frozen_by, reason) values ($1, $2, 'test')`,
        [h.f.companyA, h.people.groupAdmin],
      );
      try {
        h.addMessage('msg-frozen');
        const asking = await h.send('POST', '/api/inbox/reply-approvals', 'writerA', {
          socialAccountId: h.f.accountA,
          engineMessageId: 'msg-frozen',
          text: 'Hello',
          kind: 'media',
        });
        expect(asking.status).toBe(403);
        const approving = await approve('mgrA', r.id);
        expect(approving.status).toBe(403);
        expect((await rowOf(r.id)).status).toBe('pending');
        expect(
          await h.query(`select id from reply_approval_decisions where request_id = $1`, [r.id]),
        ).toHaveLength(0);
        expect(h.fake.replies.some((x) => x.engineMessageId === r.messageId)).toBe(false);
      } finally {
        await h.query(`delete from publishing_freezes where company_id = $1`, [h.f.companyA]);
      }
      expect((await approve('mgrA', r.id)).status).toBe(200);
    });

    it('a freeze that starts between the approval and the send fails the request instead of sending', async () => {
      const r = await ask();
      // The freeze starts as the engine is asked: simulate by freezing inside the engine call is not possible,
      // so freeze just before the last approval's send by wrapping the freeze check on the first call after the decision.
      const { FreezeService } = await import('../src/modules/publishing/freeze.service');
      const freeze = h.app.get(FreezeService);
      const original = freeze.isFrozen.bind(freeze);
      let calls = 0;
      const spy = vi.spyOn(freeze, 'isFrozen').mockImplementation(async (scope) => {
        calls += 1;
        return calls === 1 ? original(scope) : true; // free at the pre-check, frozen at the send
      });
      const res = await approve('mgrA', r.id);
      spy.mockRestore();
      expect(res.status).toBe(502);
      expect((await rowOf(r.id)).status).toBe('failed');
      expect((await rowOf(r.id)).settled_reason).toMatch(/frozen/);
      expect(h.fake.replies.some((x) => x.engineMessageId === r.messageId)).toBe(false);
    });
  });

  describe('the ladder in the sweep (4 working hours)', () => {
    // Monday 2026-11-23 09:00 local (UTC+3) = 06:00Z. Working minutes later: +120 = 11:00 local.
    const asked = new Date('2026-11-23T06:00:00Z');
    const at = (minutesLater: number) => new Date(asked.getTime() + minutesLater * MINUTE);
    const countOf = async (id: string, type: string) =>
      (
        await h.query(
          `select recipient_user_id from notifications where target_id = $1 and event_type = $2`,
          [id, type],
        )
      ).length;
    const levels = async (id: string) =>
      (
        await h.query(
          `select level from escalation_events where kind = 'reply_approval' and target_id = $1 order by level`,
          [id],
        )
      ).map((x) => x.level as number);

    it('reminds the approvers at 50%, the other holders at 100%, the escalation roles at 150% and 200%, each once', async () => {
      await clearPolicies();
      const r = await ask();
      await h.query(
        `update reply_approval_requests set requested_at = $2, due_at = $3 where id = $1`,
        [r.id, asked, at(240)],
      );
      const sweep = h.app.get(SweepService);

      expect(await sweep.runOnce(at(100))).toEqual([]);
      expect(await levels(r.id)).toEqual([]);

      // 50% = 120 working minutes: the approvers (not the writer) get a reminder, exactly once however often the sweep runs.
      await sweep.runOnce(at(120));
      await sweep.runOnce(at(130));
      expect(await levels(r.id)).toEqual([1]);
      const reminded = await h.query(
        `select recipient_user_id from notifications where target_id = $1 and event_type = 'approval.reminder'`,
        [r.id],
      );
      const ids = reminded.map((x) => x.recipient_user_id).sort();
      expect(ids).toEqual(
        [h.people.mgrA, h.people.execA, h.people.exec2A, h.people.groupMkt].sort(),
      );
      expect(ids).not.toContain(h.people.writerA);

      // 100% = 240: every holder of content.approve again as the stand-in.
      await sweep.runOnce(at(240));
      await sweep.runOnce(at(241));
      expect(await levels(r.id)).toEqual([1, 2]);
      expect(await countOf(r.id, 'approval.escalated')).toBe(4);

      // 150% = 360 and 200% = 480: the escalation roles (executives and group marketing) only.
      await sweep.runOnce(at(360));
      await sweep.runOnce(at(360));
      expect(await levels(r.id)).toEqual([1, 2, 3]);
      await sweep.runOnce(at(480));
      await sweep.runOnce(at(481));
      expect(await levels(r.id)).toEqual([1, 2, 3, 4]);
      expect(await countOf(r.id, 'approval.escalated')).toBe(4 + 3 + 3); // level 2, then execA/exec2A/groupMkt twice
      expect(await countOf(r.id, 'approval.reminder')).toBe(4);
      // Escalation never approves, rejects or sends.
      expect((await rowOf(r.id)).status).toBe('pending');
      expect(h.fake.replies.some((x) => x.engineMessageId === r.messageId)).toBe(false);
      const audited = await h.query(
        `select action from audit_events where target_id = $1 and actor_user_id is null order by id`,
        [r.id],
      );
      expect(audited.map((x) => x.action)).toEqual([
        'approval.reminded',
        'approval.escalated',
        'approval.escalated',
        'approval.escalated',
      ]);
    });

    it('does not remind someone who has already decided, and stops when the request is settled', async () => {
      await clearPolicies();
      await setPolicy('legal', 2);
      const r = await ask('writerA', { kind: 'legal_threat' });
      await h.query(`update reply_approval_requests set requested_at = $2 where id = $1`, [
        r.id,
        asked,
      ]);
      await approve('mgrA', r.id);
      await h.app.get(SweepService).runOnce(at(120));
      const reminded = (
        await h.query(
          `select recipient_user_id from notifications where target_id = $1 and event_type = 'approval.reminder'`,
          [r.id],
        )
      ).map((x) => x.recipient_user_id);
      expect(reminded).not.toContain(h.people.mgrA);
      expect(reminded).toContain(h.people.execA);
      await approve('execA', r.id); // settled and sent
      await h.app.get(SweepService).runOnce(at(480));
      expect(await levels(r.id)).toEqual([1]);
      await clearPolicies();
    });

    it('counts working time: a request made late on Saturday has not used up its time on Sunday', async () => {
      const r = await ask();
      // Saturday 2026-11-28 16:00 local = 13:00Z: 90 working minutes until 17:30, then nothing on Sunday.
      const saturday = new Date('2026-11-28T13:00:00Z');
      await h.query(`update reply_approval_requests set requested_at = $2 where id = $1`, [
        r.id,
        saturday,
      ]);
      await h.app.get(SweepService).runOnce(new Date('2026-11-29T09:00:00Z'));
      expect(await levels(r.id)).toEqual([]);
      // Monday 2026-11-30 09:30 local = 06:30Z: 90 + 60 = 150 minutes, past 120: level 1.
      await h.app.get(SweepService).runOnce(new Date('2026-11-30T06:30:00Z'));
      expect(await levels(r.id)).toEqual([1]);
    });
  });
});

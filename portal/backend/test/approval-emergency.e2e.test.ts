import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootWorld, sweepAt, type World } from './approval-rules-harness';

const HOUR = 60 * 60 * 1000;
const REASON = 'The CEO is on air in ten minutes and the statement must go out now.';

/**
 * Round 2, approvals: the emergency post (C1-14). One approver alone, a written reason, a second approval
 * owed within 24 hours that escalates when it is late. People and world: test/approval-rules-harness.ts
 * (`exec` and `exec2` hold content.emergency_approve; `mgr` and `mgr2` do not).
 */
describe('emergency approval and its confirmation (Round 2)', () => {
  let w: World;
  beforeAll(async () => {
    w = await bootWorld();
  });
  afterAll(async () => {
    await w.close();
  });

  const emergency = (requestId: string, who: string, reason: unknown = REASON) =>
    w.send('POST', `/api/approval-requests/${requestId}/emergency-approve`, who, { reason });
  const confirm = (requestId: string, who: string, body: unknown = {}) =>
    w.send('POST', `/api/approval-requests/${requestId}/confirm-emergency`, who, body);
  const row = async (requestId: string) =>
    (await w.q(`select * from approval_requests where id = $1`, [requestId]))[0];
  const followups = async (requestId: string) =>
    (
      await w.q<{ level: number }>(
        `select level from escalation_events where kind = 'emergency_followup' and target_id = $1 order by level`,
        [requestId],
      )
    ).map((e) => e.level);
  const sorted = (ids: string[]) => [...ids].sort();

  describe('settling a request alone', () => {
    it('lets an emergency approver settle a pending request, flags it, owes a second approval, and tells everyone', async () => {
      const { item, request } = await w.pending('Statement for the cameras.');
      const res = await emergency(request.id, 'exec');
      expect(res.status).toBe(201);
      const dto = await w.json(res);
      expect(dto).toMatchObject({
        status: 'approved',
        emergency: true,
        emergencyBy: w.ids.exec,
        emergencyReason: REASON,
        emergencyConfirmedAt: null,
        expired: false,
      });
      expect(dto.emergencyAt).toBeTruthy();
      expect(
        new Date(dto.emergencyConfirmDueAt).getTime() - new Date(dto.emergencyAt).getTime(),
      ).toBe(24 * HOUR);
      expect(new Date(dto.validUntil).getTime() - new Date(dto.approvedAt).getTime()).toBe(
        7 * 24 * HOUR,
      );

      // The item can be published at once: that is the point.
      expect(
        (await w.json(await w.send('GET', `/api/content-items/${item.id}`, 'writer'))).status,
      ).toBe('approved');

      // Told: the approvers, the writer and the escalation roles (once each), never the person who did it.
      const told = sorted(await w.notified(item.id, 'approval.emergency'));
      expect(told).toEqual(
        sorted([w.ids.mgr, w.ids.mgr2, w.ids.exec2, w.ids.dual, w.ids.gm, w.ids.writer]),
      );

      const trail = await w.audit(item.id, 'approval.emergency');
      expect(trail).toHaveLength(1);
      expect(trail[0]).toMatchObject({ actor_user_id: w.ids.exec });
      expect(trail[0].details).toMatchObject({ reason: REASON, approvalRequestId: request.id });
    });

    it('the post that goes out keeps the emergency flag in its audit trail', async () => {
      const { item, request } = await w.pending('Goes out on an emergency approval.');
      await emergency(request.id, 'exec');
      const res = await w.send('POST', `/api/content-items/${item.id}/publish`, 'mgr', {
        socialAccountId: w.f.accountA,
      });
      expect(res.status).toBe(201);
      const publication = await w.json(res);
      const trail = await w.audit(publication.id, 'publication.published');
      expect(trail[0].details).toMatchObject({
        emergencyApproval: true,
        emergencyBy: w.ids.exec,
        emergencyConfirmed: false,
      });
    });

    it('the approvals queue and the request show the emergency and who still has to confirm', async () => {
      const { request } = await w.pending('Shows in the queue.');
      await emergency(request.id, 'exec2');
      const queue = await w.json(
        await w.send('GET', '/api/approval-requests?status=approved', 'mgr'),
      );
      expect(queue.find((r: any) => r.id === request.id)).toMatchObject({
        emergency: true,
        emergencyBy: w.ids.exec2,
        emergencyConfirmedAt: null,
      });
    });

    it('also works when the policy owes several approvals: one emergency approver settles it alone', async () => {
      const cat = await w.category('emergency-two', 'Needs two');
      await w.policy(cat, { requiredApprovals: 2, approverRoles: ['company_executive'] });
      const { request } = await w.pending('Two owed, one given.', cat);
      const dto = await w.json(await emergency(request.id, 'exec'));
      expect(dto).toMatchObject({
        status: 'approved',
        requiredApprovals: 2,
        approvals: 1,
        emergency: true,
      });
    });

    it('refuses a reason shorter than 20 characters, an empty one and a missing one', async () => {
      const { request } = await w.pending('Reason needed.');
      for (const reason of ['too short', '   '.padEnd(30, ' '), 'x'.repeat(19), null]) {
        expect((await emergency(request.id, 'exec', reason)).status).toBe(400);
      }
      expect((await row(request.id)).status).toBe('pending');
      expect((await emergency(request.id, 'exec', 'x'.repeat(20))).status).toBe(201);
    });

    it('refuses people who do not hold the emergency permission', async () => {
      const { request } = await w.pending('Not for managers.');
      for (const who of ['mgr', 'mgr2', 'writer', 'creatorB']) {
        expect((await emergency(request.id, who)).status).toBe(403);
      }
      expect((await row(request.id)).status).toBe('pending');
    });

    it('a Group marketing person may do it too, from the group level', async () => {
      const { request } = await w.pending('Group level emergency.');
      expect((await emergency(request.id, 'gm')).status).toBe(201);
    });

    it('never lets the writer, nor anyone who wrote any version, approve in an emergency', async () => {
      // `dual` holds the emergency permission AND writes content.
      const own = await w.draft('dual', 'Written by an executive.');
      const ownRequest = await w.submit('dual', own.id);
      const refused = await emergency(ownRequest.id, 'dual');
      expect(refused.status).toBe(403);
      expect((await w.json(refused)).message).toMatch(/cannot also approve it/);

      // Someone who only edited a later version is an author too.
      const { item, request } = await w.pending('Edited by an executive.');
      const edit = await w.send('PATCH', `/api/content-items/${item.id}`, 'dual', {
        body: 'Reworded.',
      });
      expect(edit.status).toBe(200);
      const second = await w.submit('writer', item.id);
      expect((await emergency(second.id, 'dual')).status).toBe(403);
      expect((await row(request.id)).status).toBe('pending');
      expect((await row(second.id)).status).toBe('pending');
    });

    it('is refused on a request that is already settled, and on a version that is no longer the current one', async () => {
      const done = await w.approved('Already approved.');
      expect((await emergency(done.request.id, 'exec')).status).toBe(409);

      const { item, request } = await w.pending('Superseded.');
      await w.send('PATCH', `/api/content-items/${item.id}`, 'writer', {
        body: 'A newer version.',
      });
      expect((await emergency(request.id, 'exec')).status).toBe(409);
    });
  });

  describe('the confirmation owed afterwards', () => {
    it('is given by a different person who may approve; they cannot be the emergency approver or a writer', async () => {
      const { item, request } = await w.pending('Needs a second pair of eyes.');
      await emergency(request.id, 'exec');

      // The person who gave the emergency approval cannot confirm it.
      const same = await confirm(request.id, 'exec');
      expect(same.status).toBe(403);
      expect((await w.json(same)).message).toMatch(/cannot confirm it/);
      // The writer holds no approve permission; an executive who wrote a version is refused too.
      expect((await confirm(request.id, 'writer')).status).toBe(403);
      const written = await w.draft('dual', 'Dual wrote this one.');
      const writtenRequest = await w.submit('dual', written.id);
      await emergency(writtenRequest.id, 'exec');
      expect((await confirm(writtenRequest.id, 'dual')).status).toBe(403);
      expect((await row(request.id)).emergency_confirmed_at).toBeNull();

      const ok = await confirm(request.id, 'mgr', { comment: 'Checked the text, fine.' });
      expect(ok.status).toBe(201);
      const dto = await w.json(ok);
      expect(dto).toMatchObject({
        status: 'approved',
        emergency: true,
        emergencyConfirmedBy: w.ids.mgr,
        emergencyConfirmDueAt: null,
        approvals: 2,
      });
      expect(dto.emergencyConfirmedAt).toBeTruthy();
      const trail = await w.audit(item.id, 'approval.emergency_confirmed');
      expect(trail).toHaveLength(1);
      expect(trail[0]).toMatchObject({ actor_user_id: w.ids.mgr });
      expect(trail[0].details).toMatchObject({ emergencyBy: w.ids.exec, late: false });
      expect(await w.notified(item.id, 'content.approved')).toEqual(
        expect.arrayContaining([w.ids.exec, w.ids.writer]),
      );
    });

    it('a third person confirms as well as a manager does, and it cannot be confirmed twice', async () => {
      const { request } = await w.pending('Confirmed by a third.');
      await emergency(request.id, 'exec');
      expect((await confirm(request.id, 'exec2')).status).toBe(201);
      expect((await confirm(request.id, 'mgr')).status).toBe(409);
    });

    it('is refused for a request that was not an emergency, or is not settled, or is not approving anything', async () => {
      const ordinary = await w.approved('Ordinary approval.');
      expect((await confirm(ordinary.request.id, 'exec')).status).toBe(409);
      const waiting = await w.pending('Still waiting.');
      expect((await confirm(waiting.request.id, 'exec')).status).toBe(409);
      expect((await confirm(waiting.request.id, 'mgr')).status).toBe(409);
    });

    it('is refused once the emergency approval has itself expired', async () => {
      const { request } = await w.pending('Too late to confirm.');
      await emergency(request.id, 'exec');
      await w.q(
        `update approval_requests set valid_until = now() - interval '1 second' where id = $1`,
        [request.id],
      );
      const res = await confirm(request.id, 'mgr');
      expect(res.status).toBe(409);
      expect((await w.json(res)).message).toMatch(/expired/);
    });

    it('may come after the 24 hours: lateness only escalates, and the record says it was late', async () => {
      const { item, request } = await w.pending('Confirmed late.');
      await emergency(request.id, 'exec');
      await w.q(
        `update approval_requests set emergency_at = now() - interval '30 hours' where id = $1`,
        [request.id],
      );
      expect((await confirm(request.id, 'mgr')).status).toBe(201);
      expect((await w.audit(item.id, 'approval.emergency_confirmed'))[0].details.late).toBe(true);
    });
  });

  describe('the owed confirmation escalates (kind emergency_followup)', () => {
    it('tells the escalation roles at 24 hours and again at 48, once each, and stops when confirmed', async () => {
      const { item, request } = await w.pending('Never confirmed.');
      await emergency(request.id, 'exec');
      const at = '2026-11-24T00:00:00.000Z';
      await w.q(`update approval_requests set emergency_at = $2 where id = $1`, [request.id, at]);

      await sweepAt(w, '2026-11-24T23:59:59.000Z');
      expect(await followups(request.id)).toEqual([]);

      await sweepAt(w, '2026-11-25T00:00:00.000Z'); // 24 hours
      await sweepAt(w, '2026-11-25T00:00:00.000Z');
      expect(await followups(request.id)).toEqual([1]);
      const first = await w.notified(item.id, 'approval.followup_due');
      expect(sorted(first)).toEqual(sorted([w.ids.exec, w.ids.exec2, w.ids.dual, w.ids.gm]));

      await sweepAt(w, '2026-11-26T00:00:00.000Z'); // 48 hours
      await sweepAt(w, '2026-11-26T05:00:00.000Z');
      expect(await followups(request.id)).toEqual([1, 2]);
      expect(await w.notified(item.id, 'approval.followup_due')).toHaveLength(8);

      // Counted for the monthly report (level 2), once.
      const month = new Date(Date.now() + 3 * HOUR).toISOString().slice(0, 7);
      const report = await w.json(
        await w.send('GET', '/api/reports/approval-misses', 'groupAdmin'),
      );
      expect(
        report.find((r: any) => r.companyId === w.f.companyA && r.month === month),
      ).toMatchObject({
        emergencyFollowupMisses: 1,
      });

      // Escalation never approves anything by itself.
      expect((await row(request.id)).emergency_confirmed_at).toBeNull();
      const audit = await w.audit(item.id, 'approval.escalated');
      expect(audit).toHaveLength(2);
      expect(audit[0].details).toMatchObject({ kind: 'emergency_followup', level: 1 });
    });

    it('a confirmed emergency is no longer chased', async () => {
      const { item, request } = await w.pending('Confirmed in time.');
      await emergency(request.id, 'exec');
      await confirm(request.id, 'mgr');
      await w.q(
        `update approval_requests set emergency_at = '2026-11-20T00:00:00Z' where id = $1`,
        [request.id],
      );
      await sweepAt(w, '2026-11-26T00:00:00.000Z');
      expect(await followups(request.id)).toEqual([]);
      expect(await w.notified(item.id, 'approval.followup_due')).toEqual([]);
    });
  });

  describe('company walls', () => {
    it("another company's executive can neither approve in an emergency nor confirm", async () => {
      const { request } = await w.pending('Company A only.');
      expect((await emergency(request.id, 'execB')).status).toBeGreaterThanOrEqual(403);
      expect((await row(request.id)).status).toBe('pending');
      await emergency(request.id, 'exec');
      expect((await confirm(request.id, 'execB')).status).toBeGreaterThanOrEqual(403);
      expect((await row(request.id)).emergency_confirmed_at).toBeNull();
    });
  });
});

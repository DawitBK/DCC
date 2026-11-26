import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootWorld, setRequestedAt, sweepAt, type World } from './approval-rules-harness';

/**
 * Round 2, approvals: the escalation ladder (C1-11 / RQ-023, RQ-024). Times are controlled: a request's
 * `requested_at` is set, and the sweep is run "at" an instant. 2026-11-23 is a Monday; Ethiopia is UTC+3, so
 * 06:00Z is 09:00 local. People and world: test/approval-rules-harness.ts.
 */
describe('approval time limits and the escalation ladder (Round 2)', () => {
  let w: World;
  let catWorking: string;
  let catContinuous: string;
  let catCrisis: string;
  beforeAll(async () => {
    w = await bootWorld();
    catWorking = await w.category('esc-working', 'Escalation, office hours');
    await w.policy(catWorking, {
      requiredApprovals: 1,
      approverRoles: ['company_marketing_manager'],
      timeLimitHours: 2,
      clock: 'working',
    });
    catContinuous = await w.category('esc-continuous', 'Escalation, round the clock');
    await w.policy(catContinuous, {
      requiredApprovals: 1,
      approverRoles: ['company_marketing_manager'],
      timeLimitHours: 2,
      clock: 'continuous',
    });
    catCrisis = await w.category('esc-crisis', 'Escalation, crisis');
    await w.policy(catCrisis, {
      requiredApprovals: 2,
      approverRoles: ['company_executive'],
      timeLimitHours: 1,
      clock: 'continuous',
    });
  });
  afterAll(async () => {
    await w.close();
  });

  const events = async (requestId: string) =>
    (
      await w.q<{ level: number }>(
        `select level from escalation_events where kind = 'approval' and target_id = $1 order by level`,
        [requestId],
      )
    ).map((e) => e.level);
  const sorted = (ids: string[]) => [...ids].sort();
  const people = (...names: Array<keyof World['ids']>) => sorted(names.map((n) => w.ids[n]));
  const stateOf = async (requestId: string, itemId: string) => ({
    request: (await w.q(`select status from approval_requests where id = $1`, [requestId]))[0]
      .status,
    item: (await w.q(`select status from content_items where id = $1`, [itemId]))[0].status,
  });

  it('on office hours: each level fires once, at 50, 100, 150 and 200 percent, however often the sweep runs', async () => {
    const { item, request } = await w.pending('Ladder on office hours.', catWorking);
    await setRequestedAt(w, request.id, '2026-11-23T06:00:00.000Z'); // Monday 09:00 local, limit 2 working hours

    await sweepAt(w, '2026-11-23T06:59:59.000Z');
    expect(await events(request.id)).toEqual([]);

    // Level 1 at 50% (one hour): a reminder to the approvers named by the rule, never to the writer.
    await sweepAt(w, '2026-11-23T07:00:00.000Z');
    await sweepAt(w, '2026-11-23T07:00:00.000Z');
    expect(await events(request.id)).toEqual([1]);
    expect(sorted(await w.notified(item.id, 'approval.reminder'))).toEqual(people('mgr', 'mgr2'));
    expect(await w.notified(item.id, 'approval.escalated')).toEqual([]);

    // Level 2 at 100%: the stand-in (every other holder of the approve permission) and the writer.
    await sweepAt(w, '2026-11-23T08:00:00.000Z');
    await sweepAt(w, '2026-11-23T08:00:30.000Z');
    expect(await events(request.id)).toEqual([1, 2]);
    expect(sorted(await w.notified(item.id, 'approval.escalated'))).toEqual(
      people('exec', 'exec2', 'dual', 'gm', 'writer'),
    );

    // Level 3 at 150%: the escalation roles.
    await sweepAt(w, '2026-11-23T09:00:00.000Z');
    expect(await events(request.id)).toEqual([1, 2, 3]);
    const afterThree = await w.notified(item.id, 'approval.escalated');
    expect(afterThree).toHaveLength(5 + 4);

    // Level 4 at 200%: the escalation roles again, and it counts for the monthly report.
    await sweepAt(w, '2026-11-23T10:00:00.000Z');
    await sweepAt(w, '2026-11-24T10:00:00.000Z');
    expect(await events(request.id)).toEqual([1, 2, 3, 4]);
    expect(await w.notified(item.id, 'approval.escalated')).toHaveLength(5 + 4 + 4);

    // The audit trail shows who was reminded and escalated; the sweep has no human actor.
    expect(await w.audit(item.id, 'approval.reminded')).toHaveLength(1);
    const escalated = await w.audit(item.id, 'approval.escalated');
    expect(escalated).toHaveLength(3);
    expect(
      escalated.every((e) => e.actor_user_id === null && e.actor_subject === 'system:sweep'),
    ).toBe(true);

    // Nothing is approved, rejected or published by an escalation.
    expect(await stateOf(request.id, item.id)).toEqual({ request: 'pending', item: 'in_review' });
    expect(w.engine.published.filter((p) => p.dccContentId === item.id)).toHaveLength(0);
    const decisions = await w.q(`select 1 from approval_decisions where approval_request_id = $1`, [
      request.id,
    ]);
    expect(decisions).toHaveLength(0);
  });

  it('the request shows its due time, level and overdue flag while it climbs', async () => {
    const { request } = await w.pending('Shows the clock.', catWorking);
    await setRequestedAt(w, request.id, '2026-11-23T06:00:00.000Z');
    await sweepAt(w, '2026-11-23T08:00:00.000Z');
    const queue = await w.json(await w.send('GET', '/api/approval-requests?status=pending', 'mgr'));
    const row = queue.find((r: any) => r.id === request.id);
    expect(row).toMatchObject({
      timeLimitHours: 2,
      clock: 'working',
      dueAt: '2026-11-23T08:00:00.000Z',
      escalationLevel: 2,
      overdue: true,
      categoryId: catWorking,
    });
  });

  it('on office hours the night does not count: a request made at the end of the day waits for the morning', async () => {
    const { item, request } = await w.pending('Arrives at 17:00.', catWorking);
    await setRequestedAt(w, request.id, '2026-11-23T14:00:00.000Z'); // Monday 17:00 local: 30 working minutes left
    await sweepAt(w, '2026-11-24T02:00:00.000Z'); // Tuesday 05:00 local: only 30 minutes have counted
    expect(await events(request.id)).toEqual([]);
    await sweepAt(w, '2026-11-24T05:59:00.000Z'); // 08:59 local: 30 + 29
    expect(await events(request.id)).toEqual([]);
    await sweepAt(w, '2026-11-24T06:00:00.000Z'); // 09:00 local: 30 + 30 = 60 minutes = 50%
    expect(await events(request.id)).toEqual([1]);
    expect(await w.notified(item.id, 'approval.reminder')).toHaveLength(2);
  });

  it('a round-the-clock limit counts the night: the same request has run through the ladder by the next morning', async () => {
    const { item, request } = await w.pending('Arrives at 17:00, round the clock.', catContinuous);
    await setRequestedAt(w, request.id, '2026-11-23T14:00:00.000Z');
    await sweepAt(w, '2026-11-23T14:59:59.000Z');
    expect(await events(request.id)).toEqual([]);
    await sweepAt(w, '2026-11-23T15:00:00.000Z'); // 60 minutes of 120 = 50%
    expect(await events(request.id)).toEqual([1]);
    await sweepAt(w, '2026-11-24T02:00:00.000Z'); // 12 hours later
    expect(await events(request.id)).toEqual([1, 2, 3, 4]);
    expect(await w.notified(item.id, 'approval.reminder')).toHaveLength(2);
  });

  it('Sunday is not working time: a Saturday request waits until Monday', async () => {
    const { request } = await w.pending('Saturday afternoon.', catWorking);
    await setRequestedAt(w, request.id, '2026-11-28T13:00:00.000Z'); // Saturday 16:00 local: 90 working minutes left
    await sweepAt(w, '2026-11-29T12:00:00.000Z'); // Sunday noon: 90 minutes = 75%
    expect(await events(request.id)).toEqual([1]);
    await sweepAt(w, '2026-11-30T05:59:00.000Z'); // Monday 08:59 local: still 90 + 29 = 119 minutes
    expect(await events(request.id)).toEqual([1]);
    await sweepAt(w, '2026-11-30T06:00:00.000Z'); // Monday 09:00: 120 minutes = 100%
    expect(await events(request.id)).toEqual([1, 2]);
  });

  it('a public holiday is not working time either', async () => {
    const hours = await w.send('PUT', '/api/working-hours', 'writer', {
      companyId: w.f.companyA,
      workDays: [1, 2, 3, 4, 5, 6],
      startMinute: 510,
      endMinute: 1050,
      utcOffsetMinutes: 180,
      holidays: ['2026-12-07'],
    });
    expect(hours.status).toBe(200);
    const { request } = await w.pending('Before a holiday.', catWorking);
    await setRequestedAt(w, request.id, '2026-12-05T13:00:00.000Z'); // Saturday 16:00 local: 90 minutes left
    await sweepAt(w, '2026-12-07T09:00:00.000Z'); // Monday noon local, a holiday: still 90 minutes
    expect(await events(request.id)).toEqual([1]);
    await sweepAt(w, '2026-12-08T06:00:00.000Z'); // Tuesday 09:00 local: 90 + 30 = 120
    expect(await events(request.id)).toEqual([1, 2]);
    await w.send('PUT', '/api/working-hours', 'writer', {
      companyId: w.f.companyA,
      workDays: [1, 2, 3, 4, 5, 6],
      startMinute: 510,
      endMinute: 1050,
      utcOffsetMinutes: 180,
      holidays: [],
    });
  });

  it('a crisis (round the clock, one hour) escalates at 15, 30 and 45 minutes, in the middle of a Sunday night', async () => {
    const { item, request } = await w.pending('Crisis at night.', catCrisis);
    await setRequestedAt(w, request.id, '2026-11-29T01:00:00.000Z'); // Sunday 04:00 local
    await sweepAt(w, '2026-11-29T01:14:59.000Z');
    expect(await events(request.id)).toEqual([]);
    await sweepAt(w, '2026-11-29T01:15:00.000Z');
    expect(await events(request.id)).toEqual([1]);
    expect(sorted(await w.notified(item.id, 'approval.reminder'))).toEqual(
      people('exec', 'exec2', 'dual'),
    );
    await sweepAt(w, '2026-11-29T01:30:00.000Z');
    expect(await events(request.id)).toEqual([1, 2]);
    await sweepAt(w, '2026-11-29T01:45:00.000Z');
    await sweepAt(w, '2026-11-29T01:45:00.000Z');
    expect(await events(request.id)).toEqual([1, 2, 3]);
    // No level beyond the third, however long it waits: the last step is the one counted.
    await sweepAt(w, '2026-11-29T03:00:00.000Z');
    await sweepAt(w, '2026-12-29T03:00:00.000Z');
    expect(await events(request.id)).toEqual([1, 2, 3]);
    expect((await stateOf(request.id, item.id)).request).toBe('pending');
  });

  it('a request with no time limit never escalates', async () => {
    const { request } = await w.pending('Ladder-free.');
    await setRequestedAt(w, request.id, '2026-01-05T06:00:00.000Z');
    await sweepAt(w, '2026-11-26T06:00:00.000Z');
    expect(await events(request.id)).toEqual([]);
  });

  it('a request settled before its limit is not escalated, and neither is a superseded one', async () => {
    const settled = await w.pending('Approved in time.', catWorking);
    await setRequestedAt(w, settled.request.id, '2026-11-23T06:00:00.000Z');
    await w.send('POST', `/api/approval-requests/${settled.request.id}/approve`, 'mgr', {});
    await sweepAt(w, '2026-11-23T12:00:00.000Z');
    expect(await events(settled.request.id)).toEqual([]);

    const old = await w.pending('Edited after submitting.', catWorking);
    await setRequestedAt(w, old.request.id, '2026-11-23T06:00:00.000Z');
    const edit = await w.send('PATCH', `/api/content-items/${old.item.id}`, 'writer', {
      body: 'Changed text.',
    });
    expect(edit.status).toBe(200);
    await sweepAt(w, '2026-11-23T12:00:00.000Z');
    expect(await events(old.request.id)).toEqual([]);
  });

  it('after the stand-in level any other approver may decide; before it only the roles the rule names', async () => {
    const { item, request } = await w.pending('Stand-in decides.', catWorking);
    await setRequestedAt(w, request.id, '2026-11-23T06:00:00.000Z');

    const early = await w.send('POST', `/api/approval-requests/${request.id}/approve`, 'exec', {});
    expect(early.status).toBe(403);
    expect((await w.json(early)).message).toMatch(/decided by: Company marketing manager/);

    await sweepAt(w, '2026-11-23T07:00:00.000Z'); // level 1 only
    expect(
      (await w.send('POST', `/api/approval-requests/${request.id}/approve`, 'exec', {})).status,
    ).toBe(403);

    await sweepAt(w, '2026-11-23T08:00:00.000Z'); // level 2: the request passes to the stand-in
    // The writer still can never decide, whoever the stand-in is.
    expect(
      (await w.send('POST', `/api/approval-requests/${request.id}/approve`, 'writer', {})).status,
    ).toBe(403);
    const decided = await w.send(
      'POST',
      `/api/approval-requests/${request.id}/approve`,
      'exec',
      {},
    );
    expect(decided.status).toBe(201);
    expect(await w.json(decided)).toMatchObject({ status: 'approved' });
    const audit = await w.audit(item.id, 'content.approved');
    expect(audit.at(-1).details.asStandIn).toBe(true);
  });

  it('a person who wrote a version is never reminded to approve it, even when they hold an approving role', async () => {
    const item = await w.draft('dual', 'Written by someone who could approve.', catWorking);
    const request = await w.submit('dual', item.id);
    await setRequestedAt(w, request.id, '2026-11-23T06:00:00.000Z');
    await sweepAt(w, '2026-11-23T07:00:00.000Z');
    expect(await w.notified(item.id, 'approval.reminder')).not.toContain(w.ids.dual);
  });

  it('counts the misses per company and month for the monthly report, and only for the people who may read it', async () => {
    const month = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 7);
    const report = await w.json(await w.send('GET', '/api/reports/approval-misses', 'groupAdmin'));
    // Count independently: every request whose ladder reached its last level (4, or 3 for a crisis-sized limit).
    const requests = await w.q<{ id: string; clock: string; time_limit_hours: number | null }>(
      `select id, clock, time_limit_hours from approval_requests where company_id = $1`,
      [w.f.companyA],
    );
    let missed = 0;
    for (const r of requests) {
      const last = r.clock === 'continuous' && (r.time_limit_hours ?? 99) <= 1 ? 3 : 4;
      if ((await events(r.id)).includes(last)) missed += 1;
    }
    expect(missed).toBeGreaterThanOrEqual(3); // office-hours ladder, round-the-clock ladder, crisis ladder
    expect(report).toEqual([
      { companyId: w.f.companyA, month, approvalMisses: missed, emergencyFollowupMisses: 0 },
    ]);

    const narrowed = await w.json(
      await w.send('GET', `/api/reports/approval-misses?month=${month}`, 'groupAdmin'),
    );
    expect(narrowed).toHaveLength(1);
    expect(
      await w.json(await w.send('GET', '/api/reports/approval-misses?month=1999-01', 'groupAdmin')),
    ).toEqual([]);
    expect(
      (await w.send('GET', '/api/reports/approval-misses?month=nonsense', 'groupAdmin')).status,
    ).toBe(400);

    // Company B's executive sees nothing of company A.
    expect(await w.json(await w.send('GET', '/api/reports/approval-misses', 'execB'))).toEqual([]);
    // A content creator holds no report permission at all.
    expect((await w.send('GET', '/api/reports/approval-misses', 'creatorB')).status).toBe(403);
  });

  it("sweeping another company never escalates company A's requests", async () => {
    const { request } = await w.pending('Company A only.', catWorking);
    await setRequestedAt(w, request.id, '2026-11-23T06:00:00.000Z');
    await sweepAt(w, '2026-11-23T10:00:00.000Z', w.f.companyB);
    expect(await events(request.id)).toEqual([]);
  });
});

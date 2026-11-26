import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentApprovalVerifier } from '../src/modules/content/approval-verifier';
import { SweepService } from '../src/modules/working-hours/sweep.service';
import { bootWorld, sweepAt, type World } from './approval-rules-harness';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Round 2, approvals: the seven-day validity (C1-07) and the policy that carries a time limit (C1-11).
 * People and world: test/approval-rules-harness.ts.
 */
describe('approval validity and policy time limits (Round 2)', () => {
  let w: World;
  beforeAll(async () => {
    w = await bootWorld();
  });
  afterAll(async () => {
    await w.close();
  });

  const publishNow = (itemId: string, who = 'mgr') =>
    w.send('POST', `/api/content-items/${itemId}/publish`, who, { socialAccountId: w.f.accountA });
  const requestRow = async (id: string) =>
    (await w.q(`select * from approval_requests where id = $1`, [id]))[0];
  const verify = (itemId: string, now?: Date) =>
    w.app.get(ContentApprovalVerifier).verify(
      {
        idempotencyKey: `${itemId}:1:fake-linkedin-a`,
        dccContentId: itemId,
        approvalVersion: 1,
        approverUserId: w.ids.mgr,
        companyId: w.f.companyA,
        channelId: 'fake-linkedin-a',
        text: 'x',
        media: [],
        scheduledAt: null,
      },
      now,
    );

  describe('the policy API carries a time limit and a clock', () => {
    it('stores and returns timeLimitHours and clock, keeps them when a screen omits them, clears with null', async () => {
      const cat = await w.category('policy-limits', 'Policy limits');
      const set = await w.policy(cat, {
        requiredApprovals: 2,
        approverRoles: ['company_executive'],
        timeLimitHours: 24,
        clock: 'working',
      });
      expect(set).toMatchObject({ timeLimitHours: 24, clock: 'working', requiredApprovals: 2 });

      // A screen that does not know the new fields must not wipe them.
      const kept = await w.policy(cat, {
        requiredApprovals: 3,
        approverRoles: ['company_executive'],
      });
      expect(kept).toMatchObject({ timeLimitHours: 24, clock: 'working', requiredApprovals: 3 });

      const crisis = await w.policy(cat, {
        requiredApprovals: 2,
        approverRoles: ['company_executive'],
        timeLimitHours: 1,
        clock: 'continuous',
      });
      expect(crisis).toMatchObject({ timeLimitHours: 1, clock: 'continuous' });

      const cleared = await w.policy(cat, {
        requiredApprovals: 2,
        approverRoles: ['company_executive'],
        timeLimitHours: null,
      });
      expect(cleared).toMatchObject({ timeLimitHours: null, clock: 'continuous' });

      const listed = await w.json(
        await w.send('GET', `/api/approval-policies?companyId=${w.f.companyA}`, 'writer'),
      );
      expect(listed.find((p: any) => p.categoryId === cat)).toMatchObject({
        timeLimitHours: null,
        clock: 'continuous',
      });
      const trail = await w.audit(set.id, 'approval_policy.set');
      expect(trail.length).toBe(4);
      expect(trail[1].details.to).toMatchObject({ timeLimitHours: 24, clock: 'working' });
      expect(trail[2].details.from).toMatchObject({ timeLimitHours: 24 });
    });

    it('refuses a limit of zero, a negative one, a fraction, more than 30 days and an unknown clock', async () => {
      for (const bad of [
        { timeLimitHours: 0 },
        { timeLimitHours: -1 },
        { timeLimitHours: 1.5 },
        { timeLimitHours: 721 },
        { clock: 'whenever' },
      ]) {
        const res = await w.send('PUT', '/api/approval-policies', 'writer', {
          companyId: w.f.companyA,
          categoryId: null,
          requiredApprovals: 1,
          approverRoles: [],
          ...bad,
        });
        expect(res.status).toBe(400);
      }
    });

    it('a request copies the limit and the clock when submitted, and a later policy change never moves it', async () => {
      const cat = await w.category('copy-limit', 'Copy limit');
      await w.policy(cat, { requiredApprovals: 1, timeLimitHours: 24, clock: 'working' });
      const { request } = await w.pending('Copies the rule.', cat);
      expect(request).toMatchObject({ timeLimitHours: 24, clock: 'working', status: 'pending' });
      expect(request.dueAt).toBeTruthy();

      await w.policy(cat, { requiredApprovals: 2, timeLimitHours: 1, clock: 'continuous' });
      const queue = await w.json(
        await w.send('GET', '/api/approval-requests?status=pending', 'mgr'),
      );
      expect(queue.find((r: any) => r.id === request.id)).toMatchObject({
        timeLimitHours: 24,
        clock: 'working',
        requiredApprovals: 1,
      });
    });

    it('a policy with no limit gives a request with no clock', async () => {
      const { request } = await w.pending('No limit at all.');
      expect(request).toMatchObject({ timeLimitHours: null, dueAt: null, overdue: false });
    });
  });

  describe('seven days from the moment the request is settled as approved', () => {
    it('shows approvedAt and a validUntil exactly seven days later, in the request and in the queue', async () => {
      const { request } = await w.approved('Valid for a week.');
      expect(request).toMatchObject({ status: 'approved', expired: false });
      expect(new Date(request.validUntil).getTime() - new Date(request.approvedAt).getTime()).toBe(
        7 * DAY,
      );
      const queue = await w.json(
        await w.send('GET', '/api/approval-requests?status=approved', 'mgr'),
      );
      expect(queue.find((r: any) => r.id === request.id)).toMatchObject({
        approvedAt: request.approvedAt,
        validUntil: request.validUntil,
        expired: false,
      });
    });

    it('with two approvals owed, the seven days start at the SECOND approval, not the first', async () => {
      const cat = await w.category('two-owed', 'Two owed');
      await w.policy(cat, { requiredApprovals: 2 });
      const { request } = await w.pending('Needs two.', cat);
      const first = await w.json(
        await w.send('POST', `/api/approval-requests/${request.id}/approve`, 'mgr', {}),
      );
      expect(first).toMatchObject({ status: 'pending', approvedAt: null, validUntil: null });
      const second = await w.json(
        await w.send('POST', `/api/approval-requests/${request.id}/approve`, 'mgr2', {}),
      );
      expect(second.status).toBe('approved');
      expect(second.validUntil).toBeTruthy();
    });

    it('the publish gate accepts an approval at exactly its last moment and refuses it one second later', async () => {
      const { item } = await w.approved('Gate boundary.');
      const [row] = await w.q(
        `select r.valid_until from approval_requests r join content_versions v on v.id = r.content_version_id where v.content_item_id = $1`,
        [item.id],
      );
      const until = new Date(row.valid_until);
      expect(await verify(item.id, until)).toEqual({ ok: true });
      expect(await verify(item.id, new Date(until.getTime() - 1_000))).toEqual({ ok: true });
      const late = await verify(item.id, new Date(until.getTime() + 1_000));
      expect(late.ok).toBe(false);
      expect(!late.ok && late.reason).toMatch(/expired on \d{4}-\d{2}-\d{2}/);
    });

    it('the publish route refuses an expired approval with a clear reason, and publishes a valid one', async () => {
      const { item, request } = await w.approved('Too late to publish.');
      await w.q(
        `update approval_requests set valid_until = now() - interval '1 second' where id = $1`,
        [request.id],
      );
      const refused = await publishNow(item.id);
      expect(refused.status).toBe(403);
      expect((await w.json(refused)).message).toMatch(
        /expired.*Submit this version for approval again/,
      );
      expect(w.engine.published.filter((p) => p.dccContentId === item.id)).toHaveLength(0);

      const fresh = await w.approved('Publishes in time.');
      expect((await publishNow(fresh.item.id)).status).toBe(201);
    });

    it('refuses to schedule for after the approval runs out, accepts the last moment and any time before it', async () => {
      const { item, request } = await w.approved('Scheduling window.');
      const until = new Date(Date.now() + 2 * HOUR);
      until.setMilliseconds(0);
      await w.q(`update approval_requests set valid_until = $2 where id = $1`, [request.id, until]);
      const schedule = (at: Date) =>
        w.send('POST', `/api/content-items/${item.id}/publish`, 'mgr', {
          socialAccountId: w.f.accountA,
          scheduledAt: at.toISOString(),
        });
      const tooLate = await schedule(new Date(until.getTime() + 1_000));
      expect(tooLate.status).toBe(400);
      expect((await w.json(tooLate)).message).toMatch(
        /valid until .*schedule the post for a time before that/,
      );
      const ok = await schedule(until);
      expect(ok.status).toBe(201);
      expect(await w.json(ok)).toMatchObject({ status: 'scheduled' });
    });

    it('a scheduled post that was queued before expiry stays scheduled and its item is not flagged expired', async () => {
      const { item, request } = await w.approved('Queued before it ran out.');
      const until = new Date(Date.now() + 2 * HOUR);
      until.setMilliseconds(0);
      await w.q(`update approval_requests set valid_until = $2 where id = $1`, [request.id, until]);
      const res = await w.send('POST', `/api/content-items/${item.id}/publish`, 'mgr', {
        socialAccountId: w.f.accountA,
        scheduledAt: new Date(until.getTime() - HOUR).toISOString(),
      });
      expect(res.status).toBe(201);
      await sweepAt(w, new Date(until.getTime() + HOUR).toISOString());
      expect((await requestRow(request.id)).status).toBe('expired');
      const stored = await w.json(await w.send('GET', `/api/content-items/${item.id}`, 'writer'));
      expect(stored.status).toBe('approved'); // the post is queued at the engine; the approval already did its job
      const [publication] = await w.q(
        `select status from publications where content_item_id = $1`,
        [item.id],
      );
      expect(publication.status).toBe('scheduled');
    });
  });

  describe('expiry is recorded by the sweep, and noticed by reads', () => {
    it('the sweep expires the request and the item exactly one second after the seventh day, once, and tells people', async () => {
      const { item, request } = await w.approved('Nobody published me.');
      const until = '2026-11-20T12:00:00.000Z';
      await w.q(`update approval_requests set valid_until = $2 where id = $1`, [request.id, until]);

      await sweepAt(w, until); // exactly seven days: still valid
      expect((await requestRow(request.id)).status).toBe('approved');

      await sweepAt(w, '2026-11-20T12:00:01.000Z'); // one second after
      expect((await requestRow(request.id)).status).toBe('expired');
      const [stored] = await w.q(`select status from content_items where id = $1`, [item.id]);
      expect(stored.status).toBe('expired');

      const told = await w.notified(item.id, 'approval.expired');
      expect(told.sort()).toEqual([w.ids.writer, w.ids.mgr].sort()); // the writer and the approver
      expect(await w.audit(item.id, 'approval.expired')).toHaveLength(1);

      await sweepAt(w, '2026-11-25T00:00:00.000Z'); // again: nothing new
      expect(await w.notified(item.id, 'approval.expired')).toHaveLength(2);
      expect(await w.audit(item.id, 'approval.expired')).toHaveLength(1);
    });

    it('the sweep registered with the shared SweepService does the same', async () => {
      const { item, request } = await w.approved('Swept by the shared sweep.');
      await w.q(
        `update approval_requests set valid_until = now() - interval '1 minute' where id = $1`,
        [request.id],
      );
      const failures = await w.app.get(SweepService).runOnce(new Date());
      expect(failures).toEqual([]);
      expect((await requestRow(request.id)).status).toBe('expired');
      expect(
        (await w.q(`select status from content_items where id = $1`, [item.id]))[0].status,
      ).toBe('expired');
    });

    it('reading the approval after the seventh day shows it as expired and records it', async () => {
      const { item, request } = await w.approved('Noticed on read.');
      await w.q(
        `update approval_requests set valid_until = now() - interval '1 second' where id = $1`,
        [request.id],
      );
      const read = await w.json(
        await w.send('GET', `/api/content-items/${item.id}/approval`, 'writer'),
      );
      expect(read).toMatchObject({ status: 'expired', expired: true });
      expect((await requestRow(request.id)).status).toBe('expired');
      expect(await w.notified(item.id, 'approval.expired')).toContain(w.ids.writer);
      const queue = await w.json(
        await w.send('GET', '/api/approval-requests?status=expired', 'mgr'),
      );
      expect(queue.map((r: any) => r.id)).toContain(request.id);
      const approvedQueue = await w.json(
        await w.send('GET', '/api/approval-requests?status=approved', 'mgr'),
      );
      expect(approvedQueue.map((r: any) => r.id)).not.toContain(request.id);
    });

    it('the queue treats an approval past its seven days as expired even before anyone recorded it', async () => {
      const { request } = await w.approved('Listed before swept.');
      await w.q(
        `update approval_requests set valid_until = now() - interval '1 second' where id = $1`,
        [request.id],
      );
      const expired = await w.json(
        await w.send('GET', '/api/approval-requests?status=expired', 'mgr'),
      );
      expect(expired.find((r: any) => r.id === request.id)).toMatchObject({
        status: 'expired',
        expired: true,
      });
      const approved = await w.json(
        await w.send('GET', '/api/approval-requests?status=approved', 'mgr'),
      );
      expect(approved.map((r: any) => r.id)).not.toContain(request.id);
    });

    it('an item that was already published stays published when its old approval runs out, and nobody is told', async () => {
      const { item, request } = await w.approved('Already out.');
      expect((await publishNow(item.id)).status).toBe(201);
      await w.q(
        `update approval_requests set valid_until = now() - interval '1 second' where id = $1`,
        [request.id],
      );
      await sweepAt(w, new Date().toISOString());
      expect((await requestRow(request.id)).status).toBe('expired');
      expect(
        (await w.q(`select status from content_items where id = $1`, [item.id]))[0].status,
      ).toBe('published');
      expect(await w.notified(item.id, 'approval.expired')).toEqual([]);
    });

    it('never touches the other company: sweeping company B leaves company A approvals alone', async () => {
      const { request } = await w.approved('Company A only.');
      await w.q(
        `update approval_requests set valid_until = now() - interval '1 minute' where id = $1`,
        [request.id],
      );
      await sweepAt(w, new Date().toISOString(), w.f.companyB);
      expect((await requestRow(request.id)).status).toBe('approved');
    });
  });

  describe('a new submission after expiry starts the whole process again', () => {
    it('is allowed once the sweep has expired it, and needs a fresh approval before it publishes', async () => {
      const { item, request } = await w.approved('Again after a week.');
      await w.q(
        `update approval_requests set valid_until = now() - interval '1 second' where id = $1`,
        [request.id],
      );
      await sweepAt(w, new Date().toISOString());
      expect(
        (await w.q(`select status from content_items where id = $1`, [item.id]))[0].status,
      ).toBe('expired');

      const second = await w.submit('writer', item.id);
      expect(second).toMatchObject({ status: 'pending', approvals: 0 });
      expect(second.id).not.toBe(request.id);
      expect((await requestRow(request.id)).status).toBe('expired'); // the history stays
      expect((await publishNow(item.id)).status).toBe(403); // pending is not approved
      expect(
        (await w.send('POST', `/api/approval-requests/${second.id}/approve`, 'mgr', {})).status,
      ).toBe(201);
      expect((await publishNow(item.id)).status).toBe(201);
    });

    it('is allowed even when nobody swept yet: the submit notices the expiry itself', async () => {
      const { item, request } = await w.approved('Resubmitted before the sweep.');
      await w.q(
        `update approval_requests set valid_until = now() - interval '1 second' where id = $1`,
        [request.id],
      );
      const second = await w.submit('writer', item.id);
      expect(second.status).toBe('pending');
      expect((await requestRow(request.id)).status).toBe('expired');
      expect(await w.notified(item.id, 'approval.expired')).toContain(w.ids.writer);
      const trail = await w.audit(item.id, 'content.submitted');
      expect(trail.at(-1).details.resubmittedAfterExpiry).toBe(true);
    });

    it('there is still only one OPEN request per version: a second submit while one is open is refused', async () => {
      const { item } = await w.pending('Open once.');
      const again = await w.send('POST', `/api/content-items/${item.id}/submit`, 'writer');
      expect(again.status).toBe(409);
      const approvedItem = await w.approved('Approved is open too.');
      expect(
        (await w.send('POST', `/api/content-items/${approvedItem.item.id}/submit`, 'writer'))
          .status,
      ).toBe(409);
    });

    it('a rejected version can be submitted again as a new request', async () => {
      const { item, request } = await w.pending('Rejected once.');
      expect(
        (
          await w.send('POST', `/api/approval-requests/${request.id}/reject`, 'mgr', {
            comment: 'No.',
          })
        ).status,
      ).toBe(201);
      const second = await w.submit('writer', item.id);
      expect(second.status).toBe('pending');
      expect(second.id).not.toBe(request.id);
    });
  });

  describe('company walls', () => {
    it("another company's person cannot read or list an approval of company A", async () => {
      const { item, request } = await w.approved('Walled.');
      expect(
        (await w.send('GET', `/api/content-items/${item.id}/approval`, 'creatorB')).status,
      ).toBe(404);
      const queue = await w.json(
        await w.send('GET', '/api/approval-requests?status=approved', 'execB'),
      );
      expect(queue.map((r: any) => r.id)).not.toContain(request.id);
      expect(
        (await w.send('POST', `/api/approval-requests/${request.id}/approve`, 'execB', {})).status,
      ).toBeGreaterThanOrEqual(403);
    });
  });
});

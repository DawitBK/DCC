import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootWorld, type World } from './approval-rules-harness';

const REASON = 'It names a price, so the stricter rule applies.';

/**
 * Round 2, approvals: changing the category of content that is in review (C1-08, RQ-034). Only to a stricter
 * category (assumption: the new rule needs at least as many different approvers), with a written reason; the
 * waiting request takes the new rule and keeps the decisions already made. People and world:
 * test/approval-rules-harness.ts.
 */
describe('category change while in review (Round 2)', () => {
  let w: World;
  let low: string; // 1 approver, office hours, 24 h
  let mid: string; // 2 approvers
  let mid2: string; // 2 approvers, other roles and clock
  let high: string; // 3 approvers, crisis clock
  beforeAll(async () => {
    w = await bootWorld();
    low = await w.category('cat-low', 'Low');
    mid = await w.category('cat-mid', 'Mid');
    mid2 = await w.category('cat-mid2', 'Mid, other rule');
    high = await w.category('cat-high', 'High');
    await w.policy(low, {
      requiredApprovals: 1,
      approverRoles: ['company_marketing_manager'],
      timeLimitHours: 24,
      clock: 'working',
    });
    await w.policy(mid, {
      requiredApprovals: 2,
      approverRoles: ['company_marketing_manager', 'company_executive'],
      timeLimitHours: 24,
      clock: 'working',
    });
    await w.policy(mid2, {
      requiredApprovals: 2,
      approverRoles: ['company_executive'],
      timeLimitHours: 48,
      clock: 'working',
    });
    await w.policy(high, {
      requiredApprovals: 3,
      approverRoles: ['company_executive', 'company_marketing_manager'],
      timeLimitHours: 1,
      clock: 'continuous',
    });
  });
  afterAll(async () => {
    await w.close();
  });

  const change = (itemId: string, who: string, categoryId: string, reason: unknown = REASON) =>
    w.send('POST', `/api/content-items/${itemId}/category`, who, { categoryId, reason });
  const categoryOf = async (itemId: string) =>
    (await w.q(`select category_id from content_items where id = $1`, [itemId]))[0].category_id;
  const requestOf = async (id: string) =>
    (await w.q(`select * from approval_requests where id = $1`, [id]))[0];

  it('takes the new rule on the waiting request, keeps the decisions already made, and audits from, to and why', async () => {
    const { item, request } = await w.pending('Mentions a price.', mid);
    const first = await w.json(
      await w.send('POST', `/api/approval-requests/${request.id}/approve`, 'mgr', {
        comment: 'Fine by me.',
      }),
    );
    expect(first).toMatchObject({ approvals: 1, requiredApprovals: 2, status: 'pending' });

    const res = await change(item.id, 'mgr2', high);
    expect(res.status).toBe(201);
    const dto = await w.json(res);
    expect(dto).toMatchObject({
      id: request.id,
      status: 'pending',
      requiredApprovals: 3,
      approverRoles: ['company_executive', 'company_marketing_manager'],
      timeLimitHours: 1,
      clock: 'continuous',
      approvals: 1, // the decision already made is kept
    });
    expect(dto.decisions).toHaveLength(1);
    expect(await categoryOf(item.id)).toBe(high);

    const trail = await w.audit(item.id, 'content.category_changed');
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ actor_user_id: w.ids.mgr2 });
    expect(trail[0].details).toMatchObject({
      reason: REASON,
      approvalRequestId: request.id,
      from: { categoryId: mid, requiredApprovals: 2, timeLimitHours: 24, clock: 'working' },
      to: { categoryId: high, requiredApprovals: 3, timeLimitHours: 1, clock: 'continuous' },
    });

    // The stricter rule now governs: it takes three, so two more are needed and a settled-looking count is not enough.
    expect(
      (
        await w.json(
          await w.send('POST', `/api/approval-requests/${request.id}/approve`, 'exec', {}),
        )
      ).status,
    ).toBe('pending');
    expect(
      (
        await w.json(
          await w.send('POST', `/api/approval-requests/${request.id}/approve`, 'exec2', {}),
        )
      ).status,
    ).toBe('approved');
  });

  it('refuses a looser category and the category it already has', async () => {
    const { item, request } = await w.pending('Already strict.', high);
    const looser = await change(item.id, 'mgr', mid);
    expect(looser.status).toBe(409);
    expect((await w.json(looser)).message).toMatch(
      /Only a stricter category.*needs 2 approvals.*already needs 3/,
    );
    expect((await change(item.id, 'mgr', low)).status).toBe(409);
    expect((await change(item.id, 'mgr', high)).status).toBe(409);
    expect(await categoryOf(item.id)).toBe(high);
    expect((await requestOf(request.id)).required_approvals).toBe(3);
    expect(await w.audit(item.id, 'content.category_changed')).toEqual([]);
  });

  it('accepts a category that is as strict (the same number of approvers) and adopts its roles and limit', async () => {
    const { item, request } = await w.pending('Same strictness.', mid);
    const dto = await w.json(await change(item.id, 'mgr', mid2));
    expect(dto).toMatchObject({
      id: request.id,
      requiredApprovals: 2,
      approverRoles: ['company_executive'],
      timeLimitHours: 48,
      clock: 'working',
    });
    expect(await categoryOf(item.id)).toBe(mid2);
  });

  it('lets content with no category move to any category that needs at least one approver', async () => {
    const { item } = await w.pending('No category yet.');
    expect((await change(item.id, 'exec', low)).status).toBe(201);
    expect(await categoryOf(item.id)).toBe(low);
  });

  it('a later change of the policy does not move the request after the category changed', async () => {
    const { item, request } = await w.pending('Snapshot after change.', low);
    await change(item.id, 'mgr', mid);
    await w.policy(mid, { requiredApprovals: 5, timeLimitHours: 2, clock: 'continuous' });
    const after = await requestOf(request.id);
    expect(after).toMatchObject({ required_approvals: 2, time_limit_hours: 24, clock: 'working' });
    await w.policy(mid, {
      requiredApprovals: 2,
      approverRoles: ['company_marketing_manager', 'company_executive'],
      timeLimitHours: 24,
      clock: 'working',
    });
  });

  it('cannot recategorise a request that is already settled: it must be submitted again', async () => {
    const approved = await w.approved('Approved already.');
    const res = await change(approved.item.id, 'mgr2', high);
    expect(res.status).toBe(409);
    expect((await w.json(res)).message).toMatch(
      /cannot be recategorised: submit the content again/,
    );

    const { item, request } = await w.pending('Rejected already.');
    await w.send('POST', `/api/approval-requests/${request.id}/reject`, 'mgr', { comment: 'No.' });
    expect((await change(item.id, 'mgr2', high)).status).toBe(409);
  });

  it('only works while the content is in review: not for a draft', async () => {
    const draft = await w.draft('writer', 'Still a draft.');
    const res = await change(draft.id, 'mgr', high);
    expect(res.status).toBe(409);
    expect((await w.json(res)).message).toMatch(/only be changed while the content is in review/);
  });

  it('never lets the person who wrote any version change it, even with the permission', async () => {
    // `dual` holds approve and review permissions as an executive and also writes.
    const item = await w.draft('dual', 'Written by an executive.', low);
    await w.submit('dual', item.id);
    const own = await change(item.id, 'dual', high);
    expect(own.status).toBe(403);
    expect(await categoryOf(item.id)).toBe(low);

    // A later editor is an author as well.
    const { item: other } = await w.pending('Edited by an executive.', low);
    await w.send('PATCH', `/api/content-items/${other.id}`, 'dual', { body: 'Edited.' });
    // The edit sent the item back to draft; submitting it again opens a new request on the new version.
    await w.submit('writer', other.id);
    expect((await change(other.id, 'dual', high)).status).toBe(403);
    // The plain writer holds no review permission at all.
    expect((await change(item.id, 'writer', high)).status).toBe(403);
  });

  it('requires a written reason of at least ten characters', async () => {
    const { item } = await w.pending('Reason needed.', low);
    for (const reason of [null, '', '   ', 'short']) {
      expect((await change(item.id, 'mgr', mid, reason)).status).toBe(400);
    }
    expect(await categoryOf(item.id)).toBe(low);
    expect((await change(item.id, 'mgr', mid, 'x'.repeat(10))).status).toBe(201);
  });

  it('refuses an unknown category, one of another group and an archived one', async () => {
    const { item } = await w.pending('Odd categories.', low);
    expect((await change(item.id, 'mgr', '00000000-0000-4000-8000-000000000000')).status).toBe(400);
    expect((await change(item.id, 'mgr', 'not-a-uuid')).status).toBe(400);
    const archived = await w.category('cat-archived', 'Archived');
    await w.send('PATCH', `/api/content-categories/${archived}`, 'groupAdmin', {
      status: 'archived',
    });
    expect((await change(item.id, 'mgr', archived)).status).toBe(400);
    expect(await categoryOf(item.id)).toBe(low);
  });

  it("another company's reviewer cannot change company A's content", async () => {
    const { item } = await w.pending('Company A only.', low);
    const res = await change(item.id, 'execB', high);
    expect(res.status).toBeGreaterThanOrEqual(403);
    expect(res.status).toBeLessThanOrEqual(404);
    expect(await categoryOf(item.id)).toBe(low);
    expect((await change(item.id, 'creatorB', high)).status).toBeGreaterThanOrEqual(403);
  });
});

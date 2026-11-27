import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootWorld, type World } from './approval-rules-harness';

/**
 * Code review of Round 2 (2026-11-27): decisions on one approval request are taken one at a time. Without a lock on the
 * request, two approvers pressing Approve in the same instant each counted only their own approval, neither settled the
 * request, and a post with two approvals stayed "waiting" for ever. And an emergency approval racing a normal approval
 * could both succeed.
 */
describe('two decisions at the same moment (code review of Round 2)', () => {
  let w: World;
  beforeAll(async () => {
    w = await bootWorld();
  });
  afterAll(async () => {
    await w.close();
  });

  it('two different approvers pressing Approve together settle a two-approver request', async () => {
    for (let round = 0; round < 6; round += 1) {
      const category = await w.category(`race-${round}`, `Race ${round}`);
      await w.policy(category, { requiredApprovals: 2, approverRoles: [] });
      const { request } = await w.pending(`Two approvals needed, round ${round}.`, category);
      const decide = (who: string) =>
        w.send('POST', `/api/approval-requests/${request.id}/approve`, who, {});
      const [a, b] = await Promise.all([decide('mgr'), decide('exec')]);
      expect([a.status, b.status]).toEqual([201, 201]);
      const row = (
        await w.q(`select status from approval_requests where id = $1`, [request.id])
      )[0];
      expect(row.status, `round ${round}`).toBe('approved');
    }
  });

  it('one person pressing Approve twice at once is counted once', async () => {
    const category = await w.category('double-click', 'Double click');
    await w.policy(category, { requiredApprovals: 2, approverRoles: [] });
    const { request } = await w.pending('One person, two clicks.', category);
    const decide = () => w.send('POST', `/api/approval-requests/${request.id}/approve`, 'mgr', {});
    const answers = await Promise.all([decide(), decide()]);
    expect(answers.map((r) => r.status).sort()).toEqual([201, 409]);
    const row = (await w.q(`select status from approval_requests where id = $1`, [request.id]))[0];
    expect(row.status).toBe('pending');
  });

  it('an emergency approval and a normal approval at the same moment: exactly one settles it', async () => {
    const category = await w.category('emergency-race', 'Emergency race');
    await w.policy(category, { requiredApprovals: 1, approverRoles: [] });
    const { request } = await w.pending('Emergency against normal.', category);
    const [normal, emergency] = await Promise.all([
      w.send('POST', `/api/approval-requests/${request.id}/approve`, 'mgr', {}),
      w.send('POST', `/api/approval-requests/${request.id}/emergency-approve`, 'exec', {
        reason: 'The statement must go out now, it cannot wait for the manager.',
      }),
    ]);
    expect([normal.status, emergency.status].sort()).toEqual([201, 409]);
    const decisions = await w.q(
      `select count(*)::int as n from approval_decisions where approval_request_id = $1 and decision = 'approved'`,
      [request.id],
    );
    expect(decisions[0].n).toBe(1);
  });
});

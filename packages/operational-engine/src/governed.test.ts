import { beforeEach, describe, expect, it } from 'vitest';
import {
  EngineOutcomeUnknownError,
  EngineRejectedError,
  FakeEngine,
  GovernanceRefusedError,
  GovernedEngine,
  InMemoryIdempotencyStore,
  type ApprovalVerifier,
  type FreezeCheck,
  type PublishRequest,
} from './index';

const request: PublishRequest = {
  idempotencyKey: 'content-1:v2:channel-1',
  dccContentId: 'content-1',
  approvalVersion: 2,
  approverUserId: 'user-approver',
  companyId: 'company-1',
  channelId: 'channel-1',
  text: 'Hello from DCC',
  scheduledAt: null,
};

describe('GovernedEngine', () => {
  let engine: FakeEngine;
  let approved: boolean;
  let frozen: boolean;
  let gate: GovernedEngine;

  beforeEach(() => {
    engine = new FakeEngine();
    approved = true;
    frozen = false;
    const approvals: ApprovalVerifier = {
      verify: async () =>
        approved ? { ok: true } : { ok: false, reason: 'version 2 is not approved' },
    };
    const freeze: FreezeCheck = { isFrozen: async () => frozen };
    gate = new GovernedEngine(engine, approvals, freeze, new InMemoryIdempotencyStore());
  });

  it('publishes an approved request once', async () => {
    const result = await gate.publish(request);
    expect(result.engineOperationId).toBe('fake-post-1');
    expect(engine.published).toHaveLength(1);
  });

  it('never reaches the engine when the content is not approved', async () => {
    approved = false;
    await expect(gate.publish(request)).rejects.toMatchObject({ reason: 'not_approved' });
    expect(engine.published).toHaveLength(0);
  });

  it('never reaches the engine while publishing is frozen', async () => {
    frozen = true;
    await expect(gate.publish(request)).rejects.toMatchObject({ reason: 'frozen' });
    expect(engine.published).toHaveLength(0);
  });

  it('a retry with the same key returns the first result and does not publish twice', async () => {
    const first = await gate.publish(request);
    const second = await gate.publish(request);
    expect(second).toEqual(first);
    expect(engine.published).toHaveLength(1);
  });

  it('a definite rejection releases the key so a corrected request can retry', async () => {
    engine.failNextWith = new EngineRejectedError('bad content', 422);
    await expect(gate.publish(request)).rejects.toBeInstanceOf(EngineRejectedError);
    await expect(gate.publish(request)).resolves.toBeDefined();
    expect(engine.published).toHaveLength(1);
  });

  it('an unknown outcome blocks blind retries until someone reconciles', async () => {
    engine.failNextWith = new EngineOutcomeUnknownError('timeout');
    await expect(gate.publish(request)).rejects.toBeInstanceOf(EngineOutcomeUnknownError);
    await expect(gate.publish(request)).rejects.toMatchObject({ reason: 'outcome_unknown' });
    expect(engine.published).toHaveLength(0);
  });

  it('a concurrent duplicate is refused while the first is in flight', async () => {
    let release!: () => void;
    const slow = new FakeEngine();
    const originalPublish = slow.publish.bind(slow);
    slow.publish = async (r) => {
      await new Promise<void>((resolve) => (release = resolve));
      return originalPublish(r);
    };
    const g = new GovernedEngine(
      slow,
      { verify: async () => ({ ok: true }) },
      { isFrozen: async () => false },
      new InMemoryIdempotencyStore(),
    );
    const first = g.publish(request);
    await new Promise((r) => setTimeout(r, 5));
    await expect(g.publish(request)).rejects.toBeInstanceOf(GovernanceRefusedError);
    release();
    await first;
    expect(slow.published).toHaveLength(1);
  });
});

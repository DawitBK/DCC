import { markApproved, type OperationalEngine } from './engine';
import {
  EngineOutcomeUnknownError,
  GovernanceRefusedError,
  type PublishRequest,
  type PublishResult,
} from './types';

export type ApprovalDecision = { ok: true } | { ok: false; reason: string };

/** Implemented by DCC's backend (Hirko's content module): is THIS version of THIS content approved for THIS channel? */
export interface ApprovalVerifier {
  verify(request: PublishRequest): Promise<ApprovalDecision>;
}

/** Implemented by DCC's backend: is publishing frozen for the company or the channel (FR-15)? */
export interface FreezeCheck {
  isFrozen(scope: { companyId: string; channelId: string }): Promise<boolean>;
}

export type IdempotencyRecord =
  { state: 'in_progress' } | { state: 'done'; result: PublishResult } | { state: 'unknown' };

/** DB-backed in production (one row per key, unique on key). The in-memory one is for tests and the fake engine. */
export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | undefined>;
  /** Atomic: returns false if the key already exists. */
  begin(key: string): Promise<boolean>;
  complete(key: string, result: PublishResult): Promise<void>;
  /** Definite failure: the engine rejected it, so the key is released and a corrected request may retry. */
  release(key: string): Promise<void>;
  /** Outcome unknown (timeout, 5xx): keep the key and require reconciliation before any retry. */
  markUnknown(key: string): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  async get(key: string) {
    return this.records.get(key);
  }
  async begin(key: string) {
    if (this.records.has(key)) return false;
    this.records.set(key, { state: 'in_progress' });
    return true;
  }
  async complete(key: string, result: PublishResult) {
    this.records.set(key, { state: 'done', result });
  }
  async release(key: string) {
    this.records.delete(key);
  }
  async markUnknown(key: string) {
    this.records.set(key, { state: 'unknown' });
  }
}

/**
 * DCC stays the authority: the engine is only ever called for a request that is (1) not frozen,
 * (2) approved for this exact content version, and (3) not already published or in flight.
 * Everything that talks to a social network from DCC goes through this class.
 */
export class GovernedEngine {
  constructor(
    private readonly engine: OperationalEngine,
    private readonly approvals: ApprovalVerifier,
    private readonly freeze: FreezeCheck,
    private readonly store: IdempotencyStore,
  ) {}

  /** Read-only passthrough for channel and post listings. */
  get raw(): Pick<OperationalEngine, 'capabilities' | 'listChannels' | 'listPosts'> {
    return this.engine;
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (
      await this.freeze.isFrozen({ companyId: request.companyId, channelId: request.channelId })
    ) {
      throw new GovernanceRefusedError(
        'Publishing is frozen for this company or channel.',
        'frozen',
      );
    }

    const decision = await this.approvals.verify(request);
    if (!decision.ok) {
      throw new GovernanceRefusedError(
        `Not approved for publication: ${decision.reason}`,
        'not_approved',
      );
    }

    const existing = await this.store.get(request.idempotencyKey);
    if (existing?.state === 'done') return existing.result;
    if (existing?.state === 'in_progress') {
      throw new GovernanceRefusedError('This publication is already in progress.', 'in_progress');
    }
    if (existing?.state === 'unknown') {
      throw new GovernanceRefusedError(
        'An earlier attempt may have reached the engine. Reconcile it before retrying.',
        'outcome_unknown',
      );
    }
    if (!(await this.store.begin(request.idempotencyKey))) {
      throw new GovernanceRefusedError('This publication is already in progress.', 'in_progress');
    }

    try {
      const result = await this.engine.publish(markApproved(request));
      await this.store.complete(request.idempotencyKey, result);
      return result;
    } catch (error) {
      if (error instanceof EngineOutcomeUnknownError)
        await this.store.markUnknown(request.idempotencyKey);
      else await this.store.release(request.idempotencyKey);
      throw error;
    }
  }
}

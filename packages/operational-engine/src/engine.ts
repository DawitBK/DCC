import type {
  EngineCapabilities,
  EngineChannel,
  EnginePost,
  InboxMessage,
  PublishRequest,
  PublishResult,
} from './types';

declare const approvedBrand: unique symbol;

/**
 * A publish request that has passed DCC's governance gate. The brand is a type-level guard: code
 * outside this package cannot construct one, so a raw engine can only be handed requests that
 * GovernedEngine approved. (It is a compile-time guard, not a runtime one: the runtime guard is
 * that the engine API key lives only on the DCC server and Postiz is not reachable by users.)
 */
export type ApprovedPublishRequest = PublishRequest & { readonly [approvedBrand]: true };

/** @internal Only GovernedEngine calls this. */
export function markApproved(request: PublishRequest): ApprovedPublishRequest {
  return request as ApprovedPublishRequest;
}

/**
 * The provider-neutral engine. Derived from what Postiz really offers (docs/engine/POSTIZ-INTEGRATION.md),
 * not from a wish list. Add a method only after the engine in use proves it can do it.
 */
export interface OperationalEngine {
  capabilities(): EngineCapabilities;
  listChannels(): Promise<EngineChannel[]>;
  publish(request: ApprovedPublishRequest): Promise<PublishResult>;
  listPosts(range: { from: Date; to: Date }): Promise<EnginePost[]>;
  deletePost(engineOperationId: string): Promise<void>;
}

/**
 * Unified inbox (FR-13). Separate from OperationalEngine because the stock Postiz API has no inbox: it
 * comes from our Postiz fork (decision D-12, task W-08). An engine that lacks it simply does not
 * implement this interface; check `capabilities().inbox` and `supportsInbox()` before use.
 * A reply is public communication: the caller (Hirko's inbox module) must authorise it and audit it
 * before calling `replyToMessage`. The inbox permissions do not exist yet in the permission table
 * (`@dcc/contracts`): they and the roles that get them need Dawit's review, so they are not invented here.
 */
export interface InboxEngine {
  listInbox(range: { from: Date; to: Date }, engineChannelId?: string): Promise<InboxMessage[]>;
  replyToMessage(engineMessageId: string, text: string): Promise<void>;
}

export function supportsInbox<T extends object>(engine: T): engine is T & InboxEngine {
  return (
    typeof (engine as Partial<InboxEngine>).listInbox === 'function' &&
    typeof (engine as Partial<InboxEngine>).replyToMessage === 'function'
  );
}

import type {
  EngineCapabilities,
  EngineChannel,
  EnginePost,
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

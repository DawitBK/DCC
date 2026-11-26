/**
 * Moderation of comments and messages (Round 2, E-14). An OPTIONAL capability, separate from `InboxEngine` like analytics:
 * an engine that cannot hide, delete or block simply does not implement it, and the portal then records the action with
 * the outcome `recorded_only` and tells the person to do it in the network's own inbox. The stock Postiz API has none of
 * these, so the Postiz adapter does not implement this interface.
 * The caller (DCC's moderation service) authorises and audits the action before calling.
 */
export interface ModerationEngine {
  /** Hide a comment from the public (it can be shown again in the network). */
  hideMessage(engineMessageId: string): Promise<void>;
  /** Delete a comment. */
  deleteMessage(engineMessageId: string): Promise<void>;
  /** Block the author of this message from the account. */
  blockAuthor(engineMessageId: string): Promise<void>;
}

export function supportsModeration<T extends object>(engine: T): engine is T & ModerationEngine {
  return (
    typeof (engine as Partial<ModerationEngine>).hideMessage === 'function' &&
    typeof (engine as Partial<ModerationEngine>).deleteMessage === 'function' &&
    typeof (engine as Partial<ModerationEngine>).blockAuthor === 'function'
  );
}

import { supportsAnalytics } from './engine';
import type {
  AnalyticsEngine,
  ApprovedPublishRequest,
  InboxEngine,
  OperationalEngine,
} from './engine';
import type { FakeEngine } from './fake';
import {
  EngineUnsupportedError,
  type AnalyticsResult,
  type EngineCapabilities,
  type EngineChannel,
  type EnginePost,
  type PublishResult,
} from './types';

/** Every practice channel id starts with this, so a practice channel can never be mistaken for a real one. */
export const PRACTICE_CHANNEL_PREFIX = 'fake-';
/** Every post id the practice engine gives out starts with this. */
const PRACTICE_POST_PREFIX = 'fake-post-';

/**
 * A real engine with practice channels beside it. For development, demonstrations and the mirror only:
 * the real engine's channels (the networks someone really connected) and the practice channels (in
 * memory, nothing leaves this computer) appear in one list, and each request goes to the engine that
 * owns the channel. It still sits BEHIND GovernedEngine: approval, freeze and idempotency apply to both.
 *
 * The inbox is the practice inbox only: the stock real engine has none (it comes from the fork, W-08).
 */
export class CompositeEngine implements OperationalEngine, InboxEngine, AnalyticsEngine {
  constructor(
    private readonly real: OperationalEngine,
    private readonly practice: FakeEngine,
  ) {}

  private isPractice(channelId: string): boolean {
    return channelId.startsWith(PRACTICE_CHANNEL_PREFIX);
  }

  capabilities(): EngineCapabilities {
    const real = this.real.capabilities();
    return {
      ...real,
      inbox: true,
      analytics: true,
      notes: [
        ...real.notes,
        'Practice channels are switched on beside the real ones: their names say so, and nothing sent to them leaves this computer.',
        'The inbox shows practice messages only; the real engine has no inbox yet.',
      ],
    };
  }

  async listChannels(): Promise<EngineChannel[]> {
    const [real, practice] = await Promise.all([
      this.real.listChannels(),
      this.practice.listChannels(),
    ]);
    return [...real, ...practice];
  }

  publish(request: ApprovedPublishRequest): Promise<PublishResult> {
    return this.isPractice(request.channelId)
      ? this.practice.publish(request)
      : this.real.publish(request);
  }

  async listPosts(range: { from: Date; to: Date }): Promise<EnginePost[]> {
    const [real, practice] = await Promise.all([
      this.real.listPosts(range),
      this.practice.listPosts(range),
    ]);
    return [...real, ...practice];
  }

  deletePost(engineOperationId: string): Promise<void> {
    // By the id's shape, not by what the practice engine remembers: it forgets its posts when the
    // backend restarts, and a practice post must never be sent to the real engine to delete.
    return engineOperationId.startsWith(PRACTICE_POST_PREFIX)
      ? this.practice.deletePost(engineOperationId)
      : this.real.deletePost(engineOperationId);
  }

  async channelAnalytics(engineChannelId: string, days: number): Promise<AnalyticsResult> {
    if (this.isPractice(engineChannelId))
      return this.practice.channelAnalytics(engineChannelId, days);
    return this.realAnalytics().channelAnalytics(engineChannelId, days);
  }

  async postAnalytics(engineOperationId: string, days: number): Promise<AnalyticsResult> {
    // By the id's shape, like deletePost: a practice post is never asked of the real engine.
    if (engineOperationId.startsWith(PRACTICE_POST_PREFIX))
      return this.practice.postAnalytics(engineOperationId, days);
    return this.realAnalytics().postAnalytics(engineOperationId, days);
  }

  private realAnalytics(): AnalyticsEngine {
    if (!supportsAnalytics(this.real))
      throw new EngineUnsupportedError('The real engine does not provide analytics.');
    return this.real;
  }

  listInbox(range: { from: Date; to: Date }, engineChannelId?: string) {
    return this.practice.listInbox(range, engineChannelId);
  }

  replyToMessage(engineMessageId: string, text: string) {
    return this.practice.replyToMessage(engineMessageId, text);
  }
}

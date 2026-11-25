import { supportsAnalytics, supportsInbox } from './engine';
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
/** Every inbox message id the practice engine gives out starts with this. */
const PRACTICE_MESSAGE_PREFIX = 'practice-message-';

/**
 * A real engine with practice channels beside it. For development, demonstrations and the mirror only:
 * the real engine's channels (the networks someone really connected) and the practice channels (in
 * memory, nothing leaves this computer) appear in one list, and each request goes to the engine that
 * owns the channel. It still sits BEHIND GovernedEngine: approval, freeze and idempotency apply to both.
 *
 * The inbox: practice messages come from the practice engine; the real engine's messages are included only when it
 * really has an inbox (our fork with the inbox switched on, W-08). Stock Postiz has none.
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
        this.realInbox()
          ? 'The inbox shows the engine messages and the practice messages.'
          : 'The inbox shows practice messages only; the real engine has no inbox yet.',
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

  /** The real engine's inbox, only when it really has one (a switched-off adapter says so in its capabilities). */
  private realInbox(): InboxEngine | null {
    return supportsInbox(this.real) && this.real.capabilities().inbox === true ? this.real : null;
  }

  async listInbox(range: { from: Date; to: Date }, engineChannelId?: string) {
    if (engineChannelId) {
      if (this.isPractice(engineChannelId)) return this.practice.listInbox(range, engineChannelId);
      return (await this.realInbox()?.listInbox(range, engineChannelId)) ?? [];
    }
    const [real, practice] = await Promise.all([
      this.realInbox()?.listInbox(range) ?? Promise.resolve([]),
      this.practice.listInbox(range),
    ]);
    return [...real, ...practice];
  }

  replyToMessage(engineMessageId: string, text: string) {
    // By the id's shape, like deletePost: a practice message is never sent to the real engine.
    if (engineMessageId.startsWith(PRACTICE_MESSAGE_PREFIX))
      return this.practice.replyToMessage(engineMessageId, text);
    const real = this.realInbox();
    if (!real) throw new EngineUnsupportedError('The real engine has no inbox.');
    return real.replyToMessage(engineMessageId, text);
  }
}

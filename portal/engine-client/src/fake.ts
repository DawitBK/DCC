import type {
  AnalyticsEngine,
  ApprovedPublishRequest,
  InboxEngine,
  OperationalEngine,
} from './engine';
import type { ModerationEngine } from './inbox-moderation';
import type {
  AnalyticsResult,
  EngineCapabilities,
  EngineChannel,
  EnginePost,
  InboxMessage,
  PublishResult,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** In-memory engine for tests and for developing DCC without a running Postiz. It is not a simulation of Postiz behaviour. */
export class FakeEngine implements OperationalEngine, InboxEngine, AnalyticsEngine, ModerationEngine {
  /**
   * Set an answer for one channel id or post id to rehearse the awkward cases (an 'empty' answer, a
   * 'missing' post). Without an entry the fake answers with two small invented series.
   */
  readonly analyticsAnswers = new Map<string, AnalyticsResult>();
  readonly inboxMessages: InboxMessage[] = [];
  readonly replies: { engineMessageId: string; text: string }[] = [];
  /** Every moderation call the fake received, in order. */
  readonly moderated: { action: 'hide' | 'delete' | 'block'; engineMessageId: string }[] = [];
  /** Ids of the messages the fake has hidden. */
  readonly hidden = new Set<string>();
  /** Author names the fake has blocked. */
  readonly blocked = new Set<string>();
  /** Set to make the next moderation call fail, like `failNextWith` does for publishing. */
  failNextModerationWith: Error | null = null;
  readonly published: ApprovedPublishRequest[] = [];
  readonly posts = new Map<string, EnginePost>();
  failNextWith: Error | null = null;
  private counter = 0;

  constructor(private readonly channels: EngineChannel[] = []) {}

  capabilities(): EngineCapabilities {
    return {
      provider: 'fake',
      inbox: true,
      analytics: true,
      listChannels: true,
      publish: true,
      listPosts: true,
      deletePost: true,
      verification: 'unverified',
      notes: ['In-memory fake. Not Postiz.'],
    };
  }

  async listChannels() {
    return this.channels;
  }

  async publish(request: ApprovedPublishRequest): Promise<PublishResult> {
    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = null;
      throw error;
    }
    this.published.push(request);
    const engineOperationId = `fake-post-${++this.counter}`;
    this.posts.set(engineOperationId, {
      engineOperationId,
      engineChannelId: request.channelId,
      state: request.scheduledAt ? 'queued' : 'published',
      publishDate: request.scheduledAt ?? new Date(),
      releaseUrl: null,
      error: null,
      content: request.text,
      networkPostId: request.scheduledAt ? null : `fake-network-${this.counter}`,
      creationMethod: 'api',
    });
    return { engineOperationId, engineChannelId: request.channelId };
  }

  async channelAnalytics(engineChannelId: string, days: number): Promise<AnalyticsResult> {
    return this.analyticsFor(engineChannelId, days);
  }

  async postAnalytics(engineOperationId: string, days: number): Promise<AnalyticsResult> {
    return this.analyticsFor(engineOperationId, days);
  }

  private analyticsFor(id: string, days: number): AnalyticsResult {
    if (!Number.isFinite(days) || days <= 0) {
      throw new RangeError('Analytics days must be a positive number.');
    }
    const answer = this.analyticsAnswers.get(id);
    if (answer) return { ...answer, windowDays: days };
    const day = (i: number) =>
      new Date(Date.now() - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10);
    const points = (base: number, step: number) =>
      Array.from({ length: Math.floor(days) }, (_, i) => ({
        date: day(i),
        value: base + i * step,
      }));
    return {
      status: 'ok',
      windowDays: days,
      series: [
        { label: 'Followers', points: points(1000, 5) },
        { label: 'Impressions', points: points(200, 20) },
      ],
    };
  }

  async listPosts(range: { from: Date; to: Date }) {
    return [...this.posts.values()].filter(
      (p) => p.publishDate && p.publishDate >= range.from && p.publishDate <= range.to,
    );
  }

  async deletePost(engineOperationId: string) {
    this.posts.delete(engineOperationId);
  }

  async listInbox(range: { from: Date; to: Date }, engineChannelId?: string) {
    return this.inboxMessages.filter(
      (m) =>
        m.receivedAt >= range.from &&
        m.receivedAt <= range.to &&
        (!engineChannelId || m.engineChannelId === engineChannelId),
    );
  }

  async replyToMessage(engineMessageId: string, text: string) {
    const message = this.inboxMessages.find((m) => m.engineMessageId === engineMessageId);
    if (!message) throw new Error(`No such message: ${engineMessageId}`);
    this.replies.push({ engineMessageId, text });
    message.replied = true;
  }

  private moderate(action: 'hide' | 'delete' | 'block', engineMessageId: string) {
    if (this.failNextModerationWith) {
      const error = this.failNextModerationWith;
      this.failNextModerationWith = null;
      throw error;
    }
    const message = this.inboxMessages.find((m) => m.engineMessageId === engineMessageId);
    if (!message) throw new Error(`No such message: ${engineMessageId}`);
    this.moderated.push({ action, engineMessageId });
    return message;
  }

  async hideMessage(engineMessageId: string) {
    this.moderate('hide', engineMessageId);
    this.hidden.add(engineMessageId);
  }

  async deleteMessage(engineMessageId: string) {
    const message = this.moderate('delete', engineMessageId);
    this.inboxMessages.splice(this.inboxMessages.indexOf(message), 1);
  }

  async blockAuthor(engineMessageId: string) {
    this.blocked.add(this.moderate('block', engineMessageId).authorName);
  }
}

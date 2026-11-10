import type { ApprovedPublishRequest, InboxEngine, OperationalEngine } from './engine';
import type {
  EngineCapabilities,
  EngineChannel,
  EnginePost,
  InboxMessage,
  PublishResult,
} from './types';

/** In-memory engine for tests and for developing DCC without a running Postiz. It is not a simulation of Postiz behaviour. */
export class FakeEngine implements OperationalEngine, InboxEngine {
  readonly inboxMessages: InboxMessage[] = [];
  readonly replies: { engineMessageId: string; text: string }[] = [];
  readonly published: ApprovedPublishRequest[] = [];
  readonly posts = new Map<string, EnginePost>();
  failNextWith: Error | null = null;
  private counter = 0;

  constructor(private readonly channels: EngineChannel[] = []) {}

  capabilities(): EngineCapabilities {
    return {
      provider: 'fake',
      inbox: true,
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
    });
    return { engineOperationId, engineChannelId: request.channelId };
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
}

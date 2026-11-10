import type { SocialPlatform } from '@dcc/contracts';
import type { ApprovedPublishRequest, OperationalEngine } from './engine';
import {
  EngineOutcomeUnknownError,
  EngineRejectedError,
  type EngineCapabilities,
  type EngineChannel,
  type EnginePost,
  type EnginePostState,
  type PublishResult,
} from './types';

/**
 * Postiz adapter. Pinned target: Postiz v2.25.3 (docs/engine/POSTIZ-INTEGRATION.md).
 *
 * Endpoints used come from Postiz's published OpenAPI document (public-api/openapi.json, v1.0.0):
 *   GET    /integrations           list channels
 *   POST   /posts                  create (type: draft | schedule | now)
 *   GET    /posts?startDate&endDate  list posts in a window
 *   DELETE /posts/{id}             delete
 * Self-hosted base URL: https://{domain}/api/public/v1. Auth: the API key in the Authorization
 * header, NO "Bearer" prefix.
 *
 * STATUS: written from the spec and unit-tested against a stub. It has NOT been run against a live
 * Postiz instance. Woluman verifies it (task W-03) and flips `verification` to 'verified'.
 * Known unknowns: per-network `settings` required by each provider (only the minimal
 * { __type } is sent), media upload, and whether Postiz de-duplicates (it has no idempotency header,
 * which is why DCC's GovernedEngine keeps its own idempotency record).
 */

const PROVIDER_TO_PLATFORM: Record<string, SocialPlatform> = {
  facebook: 'facebook',
  instagram: 'instagram',
  'instagram-standalone': 'instagram',
  linkedin: 'linkedin',
  'linkedin-page': 'linkedin',
  youtube: 'youtube',
  tiktok: 'tiktok',
  x: 'x',
};

const STATE_MAP: Record<string, EnginePostState> = {
  QUEUE: 'queued',
  PUBLISHED: 'published',
  ERROR: 'error',
  DRAFT: 'draft',
};

interface PostizIntegration {
  id: string;
  name?: string;
  identifier?: string;
  disabled?: boolean;
}

interface PostizPost {
  id: string;
  publishDate?: string;
  releaseURL?: string | null;
  state?: string;
  error?: string | null;
  integration?: { id?: string };
}

export interface PostizOptions {
  /** e.g. https://postiz.internal.example/api/public/v1 */
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class PostizEngine implements OperationalEngine {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: PostizOptions) {
    this.base = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  capabilities(): EngineCapabilities {
    return {
      provider: 'postiz',
      listChannels: true,
      publish: true,
      listPosts: true,
      deletePost: true,
      verification: 'unverified',
      notes: [
        'Targets Postiz v2.25.3 public API; not yet run against a live instance.',
        'Only text posts with minimal per-network settings are sent.',
        'No analytics, media or webhook handling yet.',
      ],
    };
  }

  async listChannels(): Promise<EngineChannel[]> {
    const items = await this.request<PostizIntegration[]>('GET', '/integrations');
    return items.map((i) => ({
      engineChannelId: i.id,
      name: i.name ?? i.id,
      providerIdentifier: i.identifier ?? 'unknown',
      platform: PROVIDER_TO_PLATFORM[i.identifier ?? ''] ?? null,
      disabled: Boolean(i.disabled),
    }));
  }

  async publish(request: ApprovedPublishRequest): Promise<PublishResult> {
    const channels = await this.listChannels();
    const channel = channels.find((c) => c.engineChannelId === request.channelId);
    if (!channel)
      throw new EngineRejectedError(
        `Channel ${request.channelId} is not connected in the engine.`,
        404,
      );
    if (channel.disabled)
      throw new EngineRejectedError(`Channel ${request.channelId} is disabled in the engine.`, 409);

    const body = {
      type: request.scheduledAt ? 'schedule' : 'now',
      date: (request.scheduledAt ?? new Date()).toISOString(),
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: request.channelId },
          value: [{ content: request.text }],
          settings: { __type: channel.providerIdentifier },
        },
      ],
    };
    const created = await this.request<Array<{ postId: string; integration: string }>>(
      'POST',
      '/posts',
      body,
    );
    const first = created[0];
    if (!first?.postId)
      throw new EngineOutcomeUnknownError(
        'The engine accepted the request but returned no post id.',
      );
    return {
      engineOperationId: first.postId,
      engineChannelId: first.integration ?? request.channelId,
    };
  }

  async listPosts(range: { from: Date; to: Date }): Promise<EnginePost[]> {
    const qs = new URLSearchParams({
      startDate: range.from.toISOString(),
      endDate: range.to.toISOString(),
    });
    const res = await this.request<{ posts: PostizPost[] }>('GET', `/posts?${qs.toString()}`);
    return (res.posts ?? []).map((p) => ({
      engineOperationId: p.id,
      engineChannelId: p.integration?.id ?? '',
      state: STATE_MAP[p.state ?? ''] ?? 'error',
      publishDate: p.publishDate ? new Date(p.publishDate) : null,
      releaseUrl: p.releaseURL ?? null,
      error: p.error ?? null,
    }));
  }

  async deletePost(engineOperationId: string): Promise<void> {
    await this.request('DELETE', `/posts/${encodeURIComponent(engineOperationId)}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          // Postiz expects the bare key: no "Bearer" prefix.
          Authorization: this.options.apiKey,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (cause) {
      // The request may have reached the engine: unknown outcome. The message never includes the key.
      throw new EngineOutcomeUnknownError(
        `Engine ${method} ${path.split('?')[0]} failed before a response: ${(cause as Error).name}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 500) {
      throw new EngineOutcomeUnknownError(
        `Engine ${method} ${path.split('?')[0]} returned ${response.status}.`,
      );
    }
    if (!response.ok) {
      throw new EngineRejectedError(
        `Engine ${method} ${path.split('?')[0]} was rejected with ${response.status}.`,
        response.status,
      );
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

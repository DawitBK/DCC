import type { SocialPlatform } from '@dcc/contracts';
import type { AnalyticsEngine, ApprovedPublishRequest, OperationalEngine } from './engine';
import {
  EngineOutcomeUnknownError,
  EngineRejectedError,
  type AnalyticsResult,
  type EngineCapabilities,
  type EngineChannel,
  type EngineCreationMethod,
  type EngineMedia,
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
 *   GET    /analytics/{integration}?date=N      account analytics (fork public controller)
 *   GET    /analytics/post/{postId}?date=N      post analytics (fork public controller)
 * Self-hosted base URL: https://{domain}/api/public/v1. Auth: the API key in the Authorization
 * header, NO "Bearer" prefix.
 *
 * STATUS: run against a live Postiz v2.25.3 on 2026-11-14 (scripts/verify-postiz-live.ts): listing
 * channels and posts, a wrong key, an unknown channel and an unreachable engine behave as written.
 * NOT proven: a real post on a real network, scheduling and deleting one (they need a connected
 * channel, which needs a network developer app). Woluman finishes that (task W-03) and only then
 * flips `verification` to 'verified'.
 * Known unknowns: per-network `settings` required by each provider (only the minimal
 * { __type } is sent), and whether Postiz de-duplicates (it has no idempotency header, which is why
 * DCC's GovernedEngine keeps its own idempotency record). Media upload and analytics methods are
 * implemented from the pinned API/source but have not been proven against a live network.
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

/** Postiz's `CreationMethod` enum (schema.prisma). Anything not listed is reported as 'unknown'. */
const CREATION_METHOD_MAP: Record<string, EngineCreationMethod> = {
  WEB: 'web',
  API: 'api',
  CLI: 'cli',
  MCP: 'mcp',
  AUTOPOST: 'autopost',
};

interface PostizPost {
  id: string;
  publishDate?: string;
  releaseURL?: string | null;
  /** The network's own post id, set once Postiz has published. */
  releaseId?: string | null;
  content?: string | null;
  creationMethod?: string;
  state?: string;
  error?: string | null;
  integration?: { id?: string };
}

/** Native Postiz provider metric. Values and labels are not normalized across social networks. */
interface PostizAnalyticsMetric {
  label: string;
  data: Array<{ total: string | number; date: string }>;
  /** Some providers omit this field or return a placeholder rather than a real comparison. */
  percentageChange?: number;
}

type PostizPostAnalytics = PostizAnalyticsMetric[] | { missing: true };

/** A number, or null for anything else: Postiz sends totals as numbers or strings, and a blank is not zero. */
function toNumber(value: string | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `percentageChange` is dropped on purpose (several providers send a fixed 5). */
function toAnalyticsResult(
  raw: PostizAnalyticsMetric[] | PostizPostAnalytics,
  days: number,
): AnalyticsResult {
  if (!Array.isArray(raw)) {
    return {
      status: raw && raw.missing === true ? 'missing' : 'empty',
      windowDays: days,
      series: [],
    };
  }
  const series = raw.map((m) => ({
    label: m.label,
    points: (m.data ?? []).map((d) => ({ date: d.date, value: toNumber(d.total) })),
  }));
  return { status: series.length > 0 ? 'ok' : 'empty', windowDays: days, series };
}

export interface PostizOptions {
  /** e.g. https://postiz.internal.example/api/public/v1 */
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * DEVELOPMENT AND TESTS ONLY. The engine's "practice" channel type (a pretend network, see
   * docs/engine/PRACTICE-NETWORK.md) has no DCC platform. Naming one here makes those channels count as that
   * platform, so an account registered as it can be linked and published to through the whole governed path.
   * Left unset (and refused in production by the backend's settings), a practice channel is a channel DCC does not govern.
   */
  practicePlatform?: SocialPlatform;
}

export class PostizEngine implements OperationalEngine, AnalyticsEngine {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: PostizOptions) {
    let base = options.baseUrl;
    while (base.endsWith('/')) base = base.slice(0, -1); // a loop, not a regex: no backtracking risk
    this.base = base;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  capabilities(): EngineCapabilities {
    return {
      provider: 'postiz',
      analytics: true,
      listChannels: true,
      publish: true,
      listPosts: true,
      deletePost: true,
      verification: 'unverified',
      notes: [
        'Postiz v2.25.3 public API. Reading channels and posts is proven against a live instance; a real post on a real network is not proven yet.',
        'Text, pictures and videos are sent with minimal per-network settings; media upload is not proven live.',
        "Account and post analytics (AnalyticsEngine) are implemented from the pinned source but not live-verified; metrics keep each network's own names.",
        'Listed posts carry the stored text, the network post id and how the post was created; the text format (HTML or plain) is unproven until a real post.',
        'No webhook handling.',
      ],
    };
  }

  private platformOf(identifier: string | undefined): SocialPlatform | null {
    const known = PROVIDER_TO_PLATFORM[identifier ?? ''];
    if (known) return known;
    return identifier === 'practice' ? (this.options.practicePlatform ?? null) : null;
  }

  async listChannels(): Promise<EngineChannel[]> {
    const items = await this.request<PostizIntegration[]>('GET', '/integrations');
    return items.map((i) => ({
      engineChannelId: i.id,
      name: i.name ?? i.id,
      providerIdentifier: i.identifier ?? 'unknown',
      platform: this.platformOf(i.identifier),
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

    const image: { id: string; path: string }[] = [];
    for (const m of request.media ?? []) image.push(await this.uploadMedia(m));

    const body = {
      type: request.scheduledAt ? 'schedule' : 'now',
      date: (request.scheduledAt ?? new Date()).toISOString(),
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: request.channelId },
          value: [{ content: request.text, image }],
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

  /**
   * Upload media to Postiz without publishing it. Useful for verifying the
   * media endpoint independently of a connected social channel.
   */
  async uploadMedia(m: EngineMedia): Promise<{ id: string; path: string }> {
    const { readFile } = await import('node:fs/promises');
    const form = new FormData();
    form.append('file', new Blob([await readFile(m.path)], { type: m.mimeType }), m.fileName);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(this.timeoutMs, 120_000));
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}/upload`, {
        method: 'POST',
        headers: { Authorization: this.options.apiKey },
        body: form,
        signal: controller.signal,
      });
    } catch (cause) {
      // Nothing is posted yet at this point, so a failed upload is a clean refusal, not an unknown outcome.
      throw new EngineRejectedError(
        `Engine upload failed before a response: ${(cause as Error).name}`,
        502,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok)
      throw new EngineRejectedError(
        `Engine upload was rejected with ${response.status}.`,
        response.status,
      );
    const uploaded = (await response.json()) as { id?: string; path?: string };
    if (!uploaded.id || !uploaded.path)
      throw new EngineRejectedError('Engine upload returned no file id.', 502);
    return { id: uploaded.id, path: uploaded.path };
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
      content: p.content ?? null,
      networkPostId: p.releaseId ?? null,
      creationMethod: CREATION_METHOD_MAP[p.creationMethod ?? ''] ?? 'unknown',
    }));
  }

  /** Provider-neutral account analytics (AnalyticsEngine). Wraps the Postiz-native call below. */
  async channelAnalytics(engineChannelId: string, days: number): Promise<AnalyticsResult> {
    return toAnalyticsResult(await this.getChannelAnalytics(engineChannelId, days), days);
  }

  /** Provider-neutral post analytics (AnalyticsEngine). Wraps the Postiz-native call below. */
  async postAnalytics(engineOperationId: string, days: number): Promise<AnalyticsResult> {
    return toAnalyticsResult(await this.getPostAnalytics(engineOperationId, days), days);
  }

  async deletePost(engineOperationId: string): Promise<void> {
    await this.request('DELETE', `/posts/${encodeURIComponent(engineOperationId)}`);
  }

  /**
   * Read provider-native account analytics from Postiz. This remains a Postiz-specific adapter
   * method until DCC approves a provider-neutral analytics contract.
   */
  async getChannelAnalytics(integrationId: string, days = 7): Promise<PostizAnalyticsMetric[]> {
    this.validateAnalyticsDays(days);
    const query = new URLSearchParams({ date: String(days) });
    return this.request<PostizAnalyticsMetric[]>(
      'GET',
      `/analytics/${encodeURIComponent(integrationId)}?${query.toString()}`,
    );
  }

  /** Read provider-native analytics for a Postiz post; `{ missing: true }` is passed through. */
  async getPostAnalytics(engineOperationId: string, days = 7): Promise<PostizPostAnalytics> {
    this.validateAnalyticsDays(days);
    const query = new URLSearchParams({ date: String(days) });
    return this.request<PostizPostAnalytics>(
      'GET',
      `/analytics/post/${encodeURIComponent(engineOperationId)}?${query.toString()}`,
    );
  }

  private validateAnalyticsDays(days: number): void {
    if (!Number.isFinite(days) || days <= 0) {
      throw new RangeError('Analytics days must be a positive number.');
    }
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

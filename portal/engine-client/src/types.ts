import type { SocialPlatform } from '@dcc/contracts';

/** A channel (connected social account) as the engine reports it. */
export interface EngineChannel {
  /** The engine's own id (Postiz "integration id"). Stored in social_accounts.engine_channel_id. */
  engineChannelId: string;
  name: string;
  /** null = a network DCC does not govern (the engine supports more networks than DCC plans). */
  platform: SocialPlatform | null;
  /** The engine's raw provider identifier, kept for diagnostics. */
  providerIdentifier: string;
  disabled: boolean;
}

/** What DCC asks the engine to publish. Only DCC's governance gate may turn this into an ApprovedPublishRequest. */
export interface PublishRequest {
  /** Same key => same publication. Derive it from content id + approval version + channel. */
  idempotencyKey: string;
  dccContentId: string;
  /** The approved version of the content. A later edit is a new version and needs a new approval. */
  approvalVersion: number;
  approverUserId: string;
  companyId: string;
  channelId: string;
  text: string;
  /** Pictures and videos of the approved version, in order. Files on this server's disk. */
  media?: EngineMedia[];
  /** null = publish now. */
  scheduledAt: Date | null;
}

/** One picture or video to send with a post. `path` is an absolute path on the DCC server. */
export interface EngineMedia {
  path: string;
  fileName: string;
  mimeType: string;
  kind: 'image' | 'video';
}

export type EnginePostState = 'draft' | 'queued' | 'published' | 'error';

/**
 * How the engine says a post was created. Postiz stores this on every post (`creationMethod`). DCC's own
 * publishes arrive through the public API, so anything but 'api' (the Postiz screen, its agent tools, its
 * auto-post rules) did not come through DCC: evidence for bypass detection (docs/engine/BYPASS-PREVENTION.md).
 */
export type EngineCreationMethod = 'web' | 'api' | 'cli' | 'mcp' | 'autopost' | 'unknown';

export interface EnginePost {
  /** The engine's post id (Postiz "postId"). */
  engineOperationId: string;
  engineChannelId: string;
  state: EnginePostState;
  publishDate: Date | null;
  /** URL of the published post on the network, when the engine knows it. */
  releaseUrl: string | null;
  /** The network's error message for state 'error'. */
  error: string | null;
  /**
   * Evidence fields (all optional: an engine that cannot report one leaves it out).
   * The post text exactly as the engine stored it. Postiz may store it as HTML, so compare after
   * removing markup and normalising white space; this is unproven until a real post (W-03).
   */
  content?: string | null;
  /** The network's own id for the published post (Postiz "releaseId"). Null until it is published. */
  networkPostId?: string | null;
  creationMethod?: EngineCreationMethod;
}

/** One reading of a metric. `value` is null when the engine returned something that is not a number. */
export interface AnalyticsPoint {
  date: string;
  value: number | null;
}

/**
 * One metric exactly as the network names it ("Followers", "Impressions"). DCC never renames a metric or
 * adds unlike metrics together: the networks do not define them the same way (docs/engine/ANALYTICS-MAPPING.md).
 * Postiz's `percentageChange` is left out on purpose: several providers send a fixed 5, not a comparison.
 */
export interface AnalyticsSeries {
  label: string;
  points: AnalyticsPoint[];
}

/**
 * What the engine said about one channel or one post.
 * 'ok': at least one series. 'empty': the engine answered with nothing, which means the network does not
 * support it, the token lacks permission, OR there was no activity: it must never be shown as zero.
 * 'missing': the engine marked the published post as gone from the network (posts only).
 */
export interface AnalyticsResult {
  status: 'ok' | 'empty' | 'missing';
  windowDays: number;
  series: AnalyticsSeries[];
}

export interface PublishResult {
  engineOperationId: string;
  engineChannelId: string;
}

/** A comment or direct message on a connected channel (unified inbox, FR-13). Provided by the Postiz fork, task W-08. */
export interface InboxMessage {
  engineMessageId: string;
  engineChannelId: string;
  kind: 'comment' | 'direct_message';
  /** The network's display name of the author; DCC does not treat it as an identity. */
  authorName: string;
  text: string;
  receivedAt: Date;
  /** Comments: the engine's post id they belong to. */
  engineOperationId: string | null;
  /** True once someone replied through the engine. Assignment and response-time tracking live in DCC. */
  replied: boolean;
}

/** What an adapter can really do. Anything not proven against a live engine must say so. */
export interface EngineCapabilities {
  provider: string;
  /** Unified inbox (listInbox / replyToMessage). Absent or false until the engine really provides it. */
  inbox?: boolean;
  /** Channel and post analytics (channelAnalytics / postAnalytics). Absent or false until the engine provides them. */
  analytics?: boolean;
  listChannels: boolean;
  publish: boolean;
  listPosts: boolean;
  deletePost: boolean;
  /** 'verified' only after a test against a running engine; 'unverified' = read from docs/spec only. */
  verification: 'verified' | 'unverified';
  notes: string[];
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
/** The engine definitely rejected the request (4xx): safe to correct and retry. */
export class EngineRejectedError extends EngineError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
/** The request may or may not have reached the engine (timeout, 5xx, dropped connection). NEVER blindly retry a publish. */
export class EngineOutcomeUnknownError extends EngineError {}
export class EngineUnsupportedError extends EngineError {}
/** DCC itself refused (not approved, frozen, duplicate in flight). Nothing reached the engine. */
export class GovernanceRefusedError extends EngineError {
  constructor(
    message: string,
    readonly reason: 'not_approved' | 'frozen' | 'in_progress' | 'outcome_unknown',
  ) {
    super(message);
  }
}

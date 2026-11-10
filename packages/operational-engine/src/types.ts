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
  /** Text content. Media: not part of the foundation (see docs/engine/POSTIZ-INTEGRATION.md). */
  text: string;
  /** null = publish now. */
  scheduledAt: Date | null;
}

export type EnginePostState = 'draft' | 'queued' | 'published' | 'error';

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
}

export interface PublishResult {
  engineOperationId: string;
  engineChannelId: string;
}

/** What an adapter can really do. Anything not proven against a live engine must say so. */
export interface EngineCapabilities {
  provider: string;
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

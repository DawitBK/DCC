/** Planned channels (proposal 5.3). Adding a channel = add it here, in the DB check constraint (new migration) and in the engine adapter. */
export const SOCIAL_PLATFORMS = [
  'facebook',
  'instagram',
  'linkedin',
  'youtube',
  'tiktok',
  'x',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_ACCOUNT_STATUSES = [
  'active',
  'needs_attention',
  'disconnected',
  'archived',
] as const;
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export const COMPANY_STATUSES = ['active', 'suspended', 'archived'] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/** The category/level approval ROUTING (which status needs which approver) is Abenezer's open A-05;
 * this is just the lifecycle a content item moves through (H-04). */
export const CONTENT_ITEM_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'rejected',
  'published',
  'archived',
] as const;
export type ContentItemStatus = (typeof CONTENT_ITEM_STATUSES)[number];

export const APPROVAL_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number];

export const APPROVAL_DECISIONS = ['commented', 'approved', 'rejected'] as const;
export type ApprovalDecisionKind = (typeof APPROVAL_DECISIONS)[number];

export const PUBLICATION_STATUSES = ['pending', 'published', 'failed'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

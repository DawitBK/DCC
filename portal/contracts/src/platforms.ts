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

export const CONTENT_CATEGORY_STATUSES = ['active', 'archived'] as const;
export type ContentCategoryStatus = (typeof CONTENT_CATEGORY_STATUSES)[number];

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

export const PUBLICATION_STATUSES = [
  'pending',
  'scheduled',
  'published',
  'failed',
  'cancelled',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

/** H-06 detail: managed data, empty until someone enters it. Archive instead of delete. */
export const INCIDENT_CATEGORY_STATUSES = ['active', 'archived'] as const;
export const INCIDENT_CONTACT_STATUSES = ['active', 'archived'] as const;
/** How a recovery contact is reached. `other` is free text in `value` (for example a chat handle). */
export const INCIDENT_CONTACT_CHANNELS = ['email', 'phone', 'other'] as const;
export type IncidentContactChannel = (typeof INCIDENT_CONTACT_CHANNELS)[number];

export const INCIDENT_STATUSES = ['open', 'investigating', 'resolved', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** H-06, in-app only (Q4 of portal/backend/QUESTIONS/QUESTIONS.md - not yet decided by Dawit; this
 * is Hirko's first-cut list, add an event here when a module needs to notify on something new). */
export const NOTIFICATION_EVENT_TYPES = [
  'content.submitted',
  'content.approved',
  'content.rejected',
  'publishing.frozen',
  'incident.opened',
  'inbox.assigned',
  'inbox.escalated',
  'inbox.reply_requested',
  'inbox.reply_decided',
  'approval.reminder',
  'approval.escalated',
  'approval.expired',
  'approval.emergency',
  'approval.followup_due',
  'incident.freeze_lift_requested',
  'incident.freeze_lifted',
  'incident.review_due',
  'incident.review_overdue',
  'incident.closed',
  'publication.removed',
  'publication.correction_requested',
  'alert.delivery_failed',
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

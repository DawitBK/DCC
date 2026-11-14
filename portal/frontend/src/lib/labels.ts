import type {
  ApprovalDecisionKind,
  ApprovalRequestStatus,
  CompanyStatus,
  ContentCategoryStatus,
  ContentItemStatus,
  IncidentSeverity,
  IncidentStatus,
  NotificationEventType,
  PublicationStatus,
  SocialAccountStatus,
  SocialPlatform,
  UserDto,
} from '@dcc/contracts';

/**
 * One label and one chip colour for every value the contracts define.
 *
 * Each table is typed `Record<TheContractType, ...>`: when a value is added to or removed from
 * `@dcc/contracts`, this file stops compiling until the label is added or removed too. The lists of
 * values themselves are never retyped here: screens loop over the arrays from `@dcc/contracts`.
 */
export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray';
export type StatusLabel = { label: string; tone: Tone };

export const CONTENT_STATUS: Record<ContentItemStatus, StatusLabel> = {
  draft: { label: 'Draft', tone: 'gray' },
  in_review: { label: 'In review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  published: { label: 'Published', tone: 'blue' },
  archived: { label: 'Archived', tone: 'gray' },
};

export const APPROVAL_REQUEST_STATUS: Record<ApprovalRequestStatus, StatusLabel> = {
  pending: { label: 'Waiting for a decision', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
};

export const APPROVAL_DECISION: Record<ApprovalDecisionKind, StatusLabel> = {
  commented: { label: 'Comment', tone: 'blue' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
};

export const PUBLICATION_STATUS: Record<PublicationStatus, StatusLabel> = {
  pending: { label: 'In progress', tone: 'amber' },
  scheduled: { label: 'Scheduled', tone: 'blue' },
  published: { label: 'Published', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
};

export const ACCOUNT_STATUS: Record<SocialAccountStatus, StatusLabel> = {
  active: { label: 'Active', tone: 'green' },
  needs_attention: { label: 'Needs attention', tone: 'amber' },
  disconnected: { label: 'Disconnected', tone: 'red' },
  archived: { label: 'Archived', tone: 'gray' },
};

export const COMPANY_STATUS: Record<CompanyStatus, StatusLabel> = {
  active: { label: 'Active', tone: 'green' },
  suspended: { label: 'Suspended', tone: 'amber' },
  archived: { label: 'Archived', tone: 'gray' },
};

export const CATEGORY_STATUS: Record<ContentCategoryStatus, StatusLabel> = {
  active: { label: 'Active', tone: 'green' },
  archived: { label: 'Archived', tone: 'gray' },
};

export const INCIDENT_STATUS: Record<IncidentStatus, StatusLabel> = {
  open: { label: 'Open', tone: 'red' },
  investigating: { label: 'Investigating', tone: 'amber' },
  resolved: { label: 'Resolved', tone: 'green' },
  closed: { label: 'Closed', tone: 'gray' },
};

export const INCIDENT_SEVERITY: Record<IncidentSeverity, StatusLabel> = {
  low: { label: 'Low', tone: 'blue' },
  medium: { label: 'Medium', tone: 'amber' },
  high: { label: 'High', tone: 'red' },
  critical: { label: 'Critical', tone: 'red' },
};

export const USER_STATUS: Record<UserDto['status'], StatusLabel> = {
  active: { label: 'Active', tone: 'green' },
  disabled: { label: 'Disabled', tone: 'gray' },
};

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
};

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  'content.submitted': 'Content waiting for review',
  'content.approved': 'Content approved',
  'content.rejected': 'Content rejected',
  'publishing.frozen': 'Publishing frozen',
  'incident.opened': 'Incident opened',
};

/** For values that arrive as a plain string (report counts keyed by status): the label if known, else the raw value. */
export function labelFrom(table: Record<string, StatusLabel>, value: string): StatusLabel {
  return table[value] ?? { label: value, tone: 'gray' };
}

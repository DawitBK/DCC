import type {
  ApprovalDecisionKind,
  ApprovalState,
  CompanyStatus,
  ContentCategoryStatus,
  ContentItemStatus,
  IncidentContactChannel,
  IncidentSeverity,
  IncidentStatus,
  NotificationEventType,
  PublicationStatus,
  ReconcileResultDto,
  Role,
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

/** `expired` (Round 2): the approval ran out before the post was published; it must be sent for review again. */
export const CONTENT_STATUS: Record<ContentItemStatus | 'expired', StatusLabel> = {
  draft: { label: 'Draft', tone: 'gray' },
  in_review: { label: 'In review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  published: { label: 'Published', tone: 'blue' },
  archived: { label: 'Archived', tone: 'gray' },
  expired: { label: 'Approval expired', tone: 'red' },
};

export const APPROVAL_REQUEST_STATUS: Record<ApprovalState, StatusLabel> = {
  pending: { label: 'Waiting for a decision', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  expired: { label: 'Expired', tone: 'red' },
};

/** How far the escalation ladder of a waiting request has gone (Round 2), in words. */
export const ESCALATION_LEVEL_LABEL: Record<number, StatusLabel> = {
  0: { label: 'On time', tone: 'green' },
  1: { label: 'Reminder sent', tone: 'amber' },
  2: { label: 'Passed to the stand-in', tone: 'amber' },
  3: { label: 'Escalated to management', tone: 'red' },
  4: { label: 'Escalated again, in the monthly report', tone: 'red' },
};

export const APPROVAL_DECISION: Record<ApprovalDecisionKind, StatusLabel> = {
  commented: { label: 'Comment', tone: 'blue' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
};

export const PUBLICATION_STATUS: Record<PublicationStatus | 'removed', StatusLabel> = {
  pending: { label: 'In progress', tone: 'amber' },
  scheduled: { label: 'Scheduled', tone: 'blue' },
  published: { label: 'Published', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
  removed: { label: 'Removed', tone: 'red' },
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

/** How a recovery contact is reached. */
export const CONTACT_CHANNEL: Record<IncidentContactChannel, string> = {
  email: 'Email',
  phone: 'Phone',
  other: 'Other',
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

type UnresolvedKey = ReconcileResultDto['unresolvedKeys'][number];

/** Why a send could not be settled after asking the engine, in words a person can act on. */
export const UNRESOLVED_REASON: Record<UnresolvedKey['reason'], string> = {
  ambiguous_match:
    'More than one post on the engine looks like this one, so DCC cannot tell which it is. Check the engine before anything is sent again.',
  no_match:
    'The engine has no post that matches. DCC does not know whether the send happened, so it will not send it again by itself.',
  engine_waiting: 'The engine has not finished with this post yet. Check again in a few minutes.',
  not_resolved:
    'DCC could not settle what happened to this send. It will not send it again until that is known.',
};

export const UNRESOLVED_STATE: Record<UnresolvedKey['state'], StatusLabel> = {
  in_progress: { label: 'Send started, no answer', tone: 'amber' },
  unknown: { label: 'Outcome unknown', tone: 'red' },
};

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  'content.submitted': 'Content waiting for review',
  'content.approved': 'Content approved',
  'content.rejected': 'Content rejected',
  'publishing.frozen': 'Publishing frozen',
  'incident.opened': 'Incident opened',
  'inbox.assigned': 'Inbox message assigned to you',
  'inbox.escalated': 'Inbox message not answered in time',
  'inbox.reply_requested': 'Reply waiting for approval',
  'inbox.reply_decided': 'Decision on your reply',
  'approval.reminder': 'Approval still waiting',
  'approval.escalated': 'Approval overdue, escalated',
  'approval.expired': 'Approval expired',
  'approval.emergency': 'Emergency post approved by one person',
  'approval.followup_due': 'Second approval of an emergency post due',
  'incident.freeze_lift_requested': 'Freeze lift needs your confirmation',
  'incident.freeze_lifted': 'Publishing freeze lifted',
  'incident.review_due': 'Post-incident review due',
  'incident.review_overdue': 'Post-incident review overdue',
  'incident.closed': 'Incident closed',
  'publication.removed': 'Published post removed',
  'publication.correction_requested': 'Correction of a published post asked for',
  'alert.delivery_failed': 'An alert could not be delivered',
};

/** What each role is for, in one plain sentence (the role's name itself is `ROLE_LABELS` in the contracts). */
export const ROLE_SUMMARY: Record<Role, string> = {
  group_admin: 'Set up companies, people, accounts and rules for the whole Group.',
  group_cto: 'Oversee security, incidents and the record of activity for the whole Group.',
  security_admin: 'Watch security, handle incidents and freeze publishing when needed.',
  group_marketing: 'Review and approve communications across all companies.',
  auditor: 'Read the record of who did what. Nothing can be changed.',
  company_admin: 'Manage one company: its accounts, people and approval rules.',
  company_executive: 'Approve and publish one company’s posts, and handle its incidents.',
  company_marketing_manager: 'Lead one company’s content: review, approve and publish.',
  content_creator: 'Write posts and send them for review.',
  content_reviewer: 'Read submitted posts and give feedback.',
  publisher: 'Publish approved posts to the company’s accounts.',
};

/** For values that arrive as a plain string (report counts keyed by status): the label if known, else the raw value. */
export function labelFrom(table: Record<string, StatusLabel>, value: string): StatusLabel {
  return table[value] ?? { label: value, tone: 'gray' };
}

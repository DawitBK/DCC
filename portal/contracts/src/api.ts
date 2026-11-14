import { z } from 'zod';
import { ROLES, type Role } from './roles';
import { ROLE_PERMISSIONS, type Permission } from './permissions';
import {
  APPROVAL_DECISIONS,
  APPROVAL_REQUEST_STATUSES,
  COMPANY_STATUSES,
  CONTENT_CATEGORY_STATUSES,
  CONTENT_ITEM_STATUSES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  NOTIFICATION_EVENT_TYPES,
  PUBLICATION_STATUSES,
  SOCIAL_ACCOUNT_STATUSES,
  SOCIAL_PLATFORMS,
} from './platforms';

const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lower-case letters, digits and single dashes only');

export const CreateCompanyRequest = z.object({
  name: z.string().trim().min(2).max(120),
  slug,
});
export type CreateCompanyRequest = z.infer<typeof CreateCompanyRequest>;

export const CreateBrandRequest = z.object({
  name: z.string().trim().min(2).max(120),
  slug,
});
export type CreateBrandRequest = z.infer<typeof CreateBrandRequest>;

export const GrantMembershipRequest = z
  .object({
    // The person, by ONE of these. `email` is how a new person gets their first role: until they hold a
    // role no administrator can see them in the people list, so nobody knows their id. They must have
    // signed in to DCC once (that is what creates them here).
    userId: z.uuid().optional(),
    email: z.email().max(254).optional(),
    role: z.enum(ROLES),
    // Omitted = a group-level grant, in the caller's own group (H-03: mirrors how CompaniesService.create
    // derives its group - never trusted as an arbitrary group id). Present = a company-level grant; the
    // company is loaded under the walls before anything is written, same as every other module.
    companyId: z.uuid().optional(),
  })
  .refine((v) => (v.userId === undefined) !== (v.email === undefined), {
    message: 'Give the person by userId or by email: exactly one of them.',
    path: ['userId'],
  });
export type GrantMembershipRequest = z.infer<typeof GrantMembershipRequest>;

const displayName = z.string().trim().min(2).max(160);
const handle = z.string().trim().min(1).max(100);
const publicUrl = z.url().max(300);

/** An account must have an owner; the backup admin (if set) must be a different person (H-02 step 5). */
export const CreateSocialAccountRequest = z
  .object({
    // Checked against the caller's own scope in the service (the company row is loaded under RLS,
    // then re-checked with authz.can) before anything is inserted - there is no existing account yet
    // to load it from.
    companyId: z.uuid(),
    platform: z.enum(SOCIAL_PLATFORMS),
    displayName,
    handle,
    publicUrl: publicUrl.optional(),
    brandId: z.uuid().optional(),
    ownerUserId: z.uuid(),
    backupAdminUserId: z.uuid().optional(),
  })
  .refine((v) => v.backupAdminUserId === undefined || v.backupAdminUserId !== v.ownerUserId, {
    message: 'The backup admin must be a different person from the owner.',
    path: ['backupAdminUserId'],
  });
export type CreateSocialAccountRequest = z.infer<typeof CreateSocialAccountRequest>;

export const UpdateSocialAccountRequest = z.object({
  displayName: displayName.optional(),
  handle: handle.optional(),
  publicUrl: publicUrl.nullable().optional(),
  brandId: z.uuid().nullable().optional(),
  ownerUserId: z.uuid().optional(),
});
export type UpdateSocialAccountRequest = z.infer<typeof UpdateSocialAccountRequest>;

export const SetAccountBackupAdminRequest = z.object({
  backupAdminUserId: z.uuid(),
});
export type SetAccountBackupAdminRequest = z.infer<typeof SetAccountBackupAdminRequest>;

export const SetAccountStatusRequest = z.object({
  status: z.enum(SOCIAL_ACCOUNT_STATUSES),
});
export type SetAccountStatusRequest = z.infer<typeof SetAccountStatusRequest>;

export const AssignAccountRequest = z.object({
  userId: z.uuid(),
});
export type AssignAccountRequest = z.infer<typeof AssignAccountRequest>;

/** H-06, first cut: register, escalate, track, resolve - optionally tied to one social account. */
export const CreateIncidentRequest = z.object({
  companyId: z.uuid(),
  socialAccountId: z.uuid().optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5_000).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
});
export type CreateIncidentRequest = z.infer<typeof CreateIncidentRequest>;

export const UpdateIncidentRequest = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(5_000).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
});
export type UpdateIncidentRequest = z.infer<typeof UpdateIncidentRequest>;

const contentBody = z.string().trim().min(1).max(10_000);

/** H-04: a draft always has a body and at least one target account. */
export const CreateContentItemRequest = z.object({
  companyId: z.uuid(),
  brandId: z.uuid().optional(),
  body: contentBody,
  targetAccountIds: z.array(z.uuid()).min(1),
  /** The kind of content (H-09). It decides which approval policy applies. Optional: no category = the company's default policy. */
  categoryId: z.uuid().optional(),
});
export type CreateContentItemRequest = z.infer<typeof CreateContentItemRequest>;

/** Every edit makes a new version (H-04 step 2). Omitting targetAccountIds keeps the previous version's targets. */
export const EditContentItemRequest = z.object({
  body: contentBody,
  targetAccountIds: z.array(z.uuid()).min(1).optional(),
});
export type EditContentItemRequest = z.infer<typeof EditContentItemRequest>;

const approvalComment = z.string().trim().min(1).max(2_000);

/** "Review" is a comment, not a decision (proposal 9.1: a distinct step from "approve"). */
export const ReviewContentRequest = z.object({ comment: approvalComment });
export type ReviewContentRequest = z.infer<typeof ReviewContentRequest>;

export const DecideApprovalRequest = z.object({ comment: approvalComment.optional() });
export type DecideApprovalRequest = z.infer<typeof DecideApprovalRequest>;

/** H-05: publish the current, approved version to one of its approved target accounts. */
export const PublishContentRequest = z.object({ socialAccountId: z.uuid() });
export type PublishContentRequest = z.infer<typeof PublishContentRequest>;

/** Omitting socialAccountId freezes the whole company; otherwise freezes just that one account. */
export const CreateFreezeRequest = z.object({
  companyId: z.uuid(),
  socialAccountId: z.uuid().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type CreateFreezeRequest = z.infer<typeof CreateFreezeRequest>;

/** Link a registered account to a channel of the operational engine; null unlinks it. */
export const LinkEngineChannelRequest = z.object({
  engineChannelId: z.string().trim().min(1).max(200).nullable(),
});
export type LinkEngineChannelRequest = z.infer<typeof LinkEngineChannelRequest>;

/** What is behind DCC for publishing. `verification` is 'verified' only after a test against a live engine. */
export interface EngineStatusDto {
  provider: string;
  verification: 'verified' | 'unverified';
  canPublish: boolean;
  inbox: boolean;
  notes: string[];
}

/** A channel held by the operational engine (a connected page or profile). */
export interface EngineChannelDto {
  engineChannelId: string;
  name: string;
  /** null = a network DCC does not govern. */
  platform: (typeof SOCIAL_PLATFORMS)[number] | null;
  disabled: boolean;
  /** The registered account it is linked to, when the caller can see that account. */
  linkedAccountId: string | null;
}

/** Roles whose holders may approve content (they hold `content.approve`). A policy may narrow approval to some of them. */
export const APPROVER_ROLES = ROLES.filter((r) => ROLE_PERMISSIONS[r].includes('content.approve'));

export const CreateContentCategoryRequest = z.object({
  key: slug,
  name: z.string().trim().min(2).max(120),
});
export type CreateContentCategoryRequest = z.infer<typeof CreateContentCategoryRequest>;

export const UpdateContentCategoryRequest = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    status: z.enum(CONTENT_CATEGORY_STATUSES).optional(),
  })
  .refine((v) => v.name !== undefined || v.status !== undefined, {
    message: 'Give a new name, a new status, or both.',
  });
export type UpdateContentCategoryRequest = z.infer<typeof UpdateContentCategoryRequest>;

export const MAX_REQUIRED_APPROVALS = 5;

/** Create or replace one company's approval policy for a category (categoryId null or absent = the company's default). */
export const SetApprovalPolicyRequest = z.object({
  companyId: z.uuid(),
  categoryId: z.uuid().nullable().optional(),
  requiredApprovals: z.number().int().min(1).max(MAX_REQUIRED_APPROVALS),
  /** Empty = any role that may approve. */
  approverRoles: z.array(z.enum(ROLES)).max(ROLES.length).default([]),
});
export type SetApprovalPolicyRequest = z.infer<typeof SetApprovalPolicyRequest>;

export interface ContentCategoryDto {
  id: string;
  groupId: string;
  key: string;
  name: string;
  status: (typeof CONTENT_CATEGORY_STATUSES)[number];
}

export interface ApprovalPolicyDto {
  id: string;
  companyId: string;
  /** null = the company's default policy. */
  categoryId: string | null;
  requiredApprovals: number;
  approverRoles: Role[];
  updatedBy: string;
  updatedAt: string;
}

export interface CompanyDto {
  id: string;
  groupId: string;
  name: string;
  slug: string;
  status: (typeof COMPANY_STATUSES)[number];
}

export interface BrandDto {
  id: string;
  companyId: string;
  name: string;
  slug: string;
}

export interface SocialAccountDto {
  id: string;
  companyId: string;
  brandId: string | null;
  platform: (typeof SOCIAL_PLATFORMS)[number];
  displayName: string;
  handle: string;
  publicUrl: string | null;
  status: (typeof SOCIAL_ACCOUNT_STATUSES)[number];
  ownerUserId: string | null;
  backupAdminUserId: string | null;
  /** The operational engine's channel this account is linked to; null = not connected, cannot be published to. */
  engineChannelId: string | null;
}

export interface AccountAssignmentDto {
  id: string;
  socialAccountId: string;
  userId: string;
}

export interface IncidentDto {
  id: string;
  companyId: string;
  socialAccountId: string | null;
  title: string;
  description: string | null;
  severity: (typeof INCIDENT_SEVERITIES)[number];
  status: (typeof INCIDENT_STATUSES)[number];
  openedBy: string;
  openedAt: string;
  resolvedAt: string | null;
}

export interface ContentVersionDto {
  id: string;
  contentItemId: string;
  companyId: string;
  versionNumber: number;
  body: string;
  targetAccountIds: string[];
  createdBy: string;
  createdAt: string;
}

export interface ContentItemDto {
  id: string;
  companyId: string;
  brandId: string | null;
  createdBy: string;
  currentVersionId: string | null;
  status: (typeof CONTENT_ITEM_STATUSES)[number];
  categoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What create/edit return: the item plus the version that call just produced, so the caller does not
 * need a second round trip to see what it wrote. */
export interface ContentItemWithVersionDto extends ContentItemDto {
  currentVersion: ContentVersionDto;
}

export interface ApprovalDecisionDto {
  id: string;
  decidedBy: string;
  decision: (typeof APPROVAL_DECISIONS)[number];
  comment: string | null;
  decidedAt: string;
}

export interface ApprovalRequestDto {
  id: string;
  contentVersionId: string;
  companyId: string;
  requestedBy: string;
  requestedAt: string;
  status: (typeof APPROVAL_REQUEST_STATUSES)[number];
  /** The rule this request was opened under (H-09): how many different people must approve ... */
  requiredApprovals: number;
  /** ... how many have so far ... */
  approvals: number;
  /** ... and which roles may decide. Empty = any role that may approve. */
  approverRoles: Role[];
  decisions: ApprovalDecisionDto[];
}

/** One row of the reviewers' queue: enough to link to the content item, without the decision history. */
export interface ApprovalQueueItemDto {
  id: string;
  contentItemId: string;
  contentVersionId: string;
  companyId: string;
  requestedBy: string;
  requestedAt: string;
  status: (typeof APPROVAL_REQUEST_STATUSES)[number];
  requiredApprovals: number;
  approvals: number;
}

export interface PublicationDto {
  id: string;
  companyId: string;
  contentItemId: string;
  contentVersionId: string;
  socialAccountId: string;
  requestedBy: string;
  approvedBy: string | null;
  engineOperationId: string | null;
  externalPostUrl: string | null;
  status: (typeof PUBLICATION_STATUSES)[number];
  error: string | null;
  requestedAt: string;
  completedAt: string | null;
}

/**
 * Internal operations counts only - NOT the engagement/reach/follower analytics the proposal
 * describes, which depend on the operational engine (not connected yet). Named "operations
 * overview" rather than "analytics" on purpose, so it is never mistaken for that.
 */
export interface OperationsOverviewDto {
  companyId: string;
  companyName: string;
  socialAccounts: { total: number; byStatus: Record<string, number> };
  contentItems: { total: number; byStatus: Record<string, number> };
  publications: { total: number; byStatus: Record<string, number> };
}

/** One account whose registry entry is incomplete or not healthy (proposal objective 1: owner and backup admin on every account). */
export interface RegistryGapDto {
  socialAccountId: string;
  companyId: string;
  platform: (typeof SOCIAL_PLATFORMS)[number];
  displayName: string;
  handle: string;
  status: string;
  /** Which required details are empty. `engine_channel` = not connected to the operational engine yet. */
  missing: ('owner' | 'backup_admin' | 'engine_channel')[];
}

/**
 * The home-screen numbers. A section is `null` (not 0) when the caller holds no permission to see it,
 * so the UI can hide it instead of showing a misleading zero. `publishedLast7Days` is a rolling window.
 */
export interface DashboardDto {
  accounts: { total: number; active: number; needsAttention: number } | null;
  pendingApprovals: number | null;
  publishedLast7Days: number | null;
  openIncidents: number | null;
  unreadNotifications: number;
}

export interface FreezeDto {
  id: string;
  companyId: string;
  /** null = the whole company is frozen. */
  socialAccountId: string | null;
  frozenBy: string;
  reason: string | null;
  frozenAt: string;
}

export interface UnreadCountDto {
  unread: number;
}

export interface MarkedReadDto {
  marked: number;
}

/**
 * In-app only (Q4, not yet decided - see portal/backend/QUESTIONS/QUESTIONS.md). Recipients are
 * everyone who held the relevant permission in the company at the moment of the event (a broadcast,
 * same model as the placeholder approval rule), not a named assignee - there is no assignee concept
 * yet. One row per recipient, so read/unread is personal.
 */
export interface NotificationDto {
  id: string;
  companyId: string;
  eventType: (typeof NOTIFICATION_EVENT_TYPES)[number];
  targetType: string;
  targetId: string;
  summary: string;
  readAt: string | null;
  createdAt: string;
}

export interface MembershipDto {
  role: Role;
  /** null = group-level (applies to every company of the group). */
  companyId: string | null;
  groupId: string;
}

/** Like MembershipDto, but carries the row id so it can be revoked (H-03). */
export interface MembershipRecordDto {
  id: string;
  role: Role;
  companyId: string | null;
  groupId: string;
  source: 'dcc' | 'idp';
}

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  memberships: MembershipRecordDto[];
}

/** What the web app learns about the signed-in person. No tokens, ever. */
export interface MeResponse {
  user: { id: string; email: string; displayName: string };
  memberships: MembershipDto[];
  /** Union of permissions, for UI visibility only. The API re-checks every request. */
  permissions: Permission[];
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  requestId?: string;
  /**
   * A short machine-readable reason, present only where the web app must react in a specific way.
   * Today there is one: `reauth_required` (401 on a sensitive action: send the person to
   * `/api/auth/login?reauth=1&returnTo=<current path>` and let them repeat the action afterwards).
   */
  code?: string;
}

/** `ApiError.code` of the 401 a sensitive action answers when the person's sign-in is too old. */
export const REAUTH_REQUIRED_CODE = 'reauth_required';

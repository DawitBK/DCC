import { z } from 'zod';
import { ROLES, type Role } from './roles';
import type { Permission } from './permissions';
import {
  APPROVAL_DECISIONS,
  APPROVAL_REQUEST_STATUSES,
  COMPANY_STATUSES,
  CONTENT_ITEM_STATUSES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  NOTIFICATION_EVENT_TYPES,
  PUBLICATION_STATUSES,
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

export const GrantMembershipRequest = z.object({
  userId: z.uuid(),
  role: z.enum(ROLES),
});
export type GrantMembershipRequest = z.infer<typeof GrantMembershipRequest>;

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
  status: string;
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
  decisions: ApprovalDecisionDto[];
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

export interface FreezeDto {
  id: string;
  companyId: string;
  /** null = the whole company is frozen. */
  socialAccountId: string | null;
  frozenBy: string;
  reason: string | null;
  frozenAt: string;
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
}

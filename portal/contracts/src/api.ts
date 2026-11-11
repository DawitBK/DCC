import { z } from 'zod';
import { ROLES, type Role } from './roles';
import type { Permission } from './permissions';
import {
  APPROVAL_DECISIONS,
  APPROVAL_REQUEST_STATUSES,
  COMPANY_STATUSES,
  CONTENT_ITEM_STATUSES,
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

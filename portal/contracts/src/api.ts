import { z } from 'zod';
import { ROLES, type Role } from './roles';
import type { Permission } from './permissions';
import { COMPANY_STATUSES, SOCIAL_PLATFORMS } from './platforms';

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
  // Omitted = a group-level grant, in the caller's own group (H-03: mirrors how CompaniesService.create
  // derives its group - never trusted as an arbitrary group id). Present = a company-level grant; the
  // company is loaded under the walls before anything is written, same as every other module.
  companyId: z.uuid().optional(),
});
export type GrantMembershipRequest = z.infer<typeof GrantMembershipRequest>;

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
}

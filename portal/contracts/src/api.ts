import { z } from 'zod';
import { ROLES, type Role } from './roles';
import type { Permission } from './permissions';
import { COMPANY_STATUSES, SOCIAL_ACCOUNT_STATUSES, SOCIAL_PLATFORMS } from './platforms';

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

const displayName = z.string().trim().min(2).max(160);
const handle = z.string().trim().min(1).max(100);
const publicUrl = z.url().max(300);

/** An account must have an owner; the backup admin (if set) must be a different person (H-02 step 5). */
export const CreateSocialAccountRequest = z
  .object({
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
}

export interface AccountAssignmentDto {
  id: string;
  socialAccountId: string;
  userId: string;
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

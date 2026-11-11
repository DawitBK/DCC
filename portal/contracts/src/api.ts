import { z } from 'zod';
import { ROLES, type Role } from './roles';
import type { Permission } from './permissions';
import {
  COMPANY_STATUSES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
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

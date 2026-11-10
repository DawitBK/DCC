/**
 * DCC roles (source: proposal section 7.3 plus the team document's "group administrator" and
 * "company administrator"). A role is held either at GROUP level (applies to every company of the
 * group) or at COMPANY level (applies to one company only). The proposal says a company
 * administrator "never gains access to another subsidiary's accounts automatically", so
 * company-level roles can never be widened implicitly.
 */
export const GROUP_ONLY_ROLES = [
  'group_admin',
  'group_cto',
  'security_admin',
  'group_marketing',
] as const;

export const COMPANY_ONLY_ROLES = [
  'company_admin',
  'company_executive',
  'company_marketing_manager',
  'content_creator',
  'content_reviewer',
  'publisher',
] as const;

/** The auditor is read-only and may be granted for the whole group or for one company. */
export const EITHER_SCOPE_ROLES = ['auditor'] as const;

export const ROLES = [...GROUP_ONLY_ROLES, ...COMPANY_ONLY_ROLES, ...EITHER_SCOPE_ROLES] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** True when `role` may be held at the given scope (`companyId` null = group level). */
export function roleAllowedAtScope(role: Role, scope: 'group' | 'company'): boolean {
  if ((GROUP_ONLY_ROLES as readonly string[]).includes(role)) return scope === 'group';
  if ((COMPANY_ONLY_ROLES as readonly string[]).includes(role)) return scope === 'company';
  return true;
}

export const ROLE_LABELS: Record<Role, string> = {
  group_admin: 'Group administrator',
  group_cto: 'Group CTO',
  security_admin: 'Security administrator',
  group_marketing: 'Group marketing and communications',
  auditor: 'Auditor',
  company_admin: 'Company administrator',
  company_executive: 'Company CEO / executive',
  company_marketing_manager: 'Company marketing manager',
  content_creator: 'Content creator',
  content_reviewer: 'Content reviewer',
  publisher: 'Publisher',
};

import type { Role } from './roles';

/**
 * Permission catalogue. A permission is `<resource>.<action>`.
 * The role -> permission table below is the ONE place that decides what a role may do. The API
 * enforces it server-side; the web app may use it only to decide what to SHOW, never to protect.
 *
 * Changing this table changes security behaviour: it needs a Dawit review (CODEOWNERS) and an
 * update to the separation-of-duties tests.
 */
export const PERMISSIONS = [
  'company.read',
  'company.manage',
  'brand.read',
  'brand.manage',
  'user.read',
  'user.manage',
  'account.read',
  'account.manage',
  'content.read',
  'content.create',
  'content.submit',
  'content.review',
  'content.approve',
  'content.publish',
  'approval_policy.manage',
  'publishing.freeze',
  'audit.read',
  'security.read',
  'security.manage',
  'incident.read',
  'incident.manage',
  'report.read',
  'inbox.read',
  'inbox.reply',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ALL: Permission[] = [
  'company.read',
  'brand.read',
  'user.read',
  'account.read',
  'content.read',
  'report.read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Platform ownership and administration. Oversight only: cannot publish (proposal 7.3).
  group_admin: [
    ...READ_ALL,
    'company.manage',
    'brand.manage',
    'user.manage',
    'account.manage',
    'approval_policy.manage',
    'publishing.freeze',
  ],
  // Technical governance and security oversight. "No (oversight)" on publishing.
  group_cto: [
    ...READ_ALL,
    'security.read',
    'security.manage',
    'incident.read',
    'incident.manage',
    'audit.read',
    'publishing.freeze',
  ],
  security_admin: [
    ...READ_ALL,
    'security.read',
    'security.manage',
    'incident.read',
    'incident.manage',
    'audit.read',
    'publishing.freeze',
  ],
  // "Approve only" for Group-level announcements.
  group_marketing: [
    ...READ_ALL,
    'content.review',
    'content.approve',
    'incident.read',
    'inbox.read',
  ],
  // Read-only access to audit and compliance records.
  auditor: ['company.read', 'brand.read', 'account.read', 'audit.read', 'report.read'],

  company_admin: [
    ...READ_ALL,
    'brand.manage',
    'user.manage',
    'account.manage',
    'approval_policy.manage',
    'publishing.freeze',
    'incident.read',
    'inbox.read',
  ],
  // "Approve, publish".
  company_executive: [
    ...READ_ALL,
    'content.review',
    'content.approve',
    'content.publish',
    'incident.read',
    'incident.manage',
    'publishing.freeze',
    'inbox.read',
    'inbox.reply',
  ],
  // "Approve, publish".
  company_marketing_manager: [
    ...READ_ALL,
    'content.create',
    'content.submit',
    'content.review',
    'content.approve',
    'content.publish',
    'incident.read',
    'inbox.read',
    'inbox.reply',
  ],
  // The proposal table shows "publish" in this cell, which reads as a typo for "No".
  // ASSUMPTION ASM-03 (docs/project/ASSUMPTIONS.md): creators cannot publish.
  content_creator: [
    'company.read',
    'brand.read',
    'account.read',
    'content.read',
    'content.create',
    'content.submit',
  ],
  // Same ASSUMPTION ASM-03: reviewers request corrections but cannot publish.
  content_reviewer: [
    'company.read',
    'brand.read',
    'account.read',
    'content.read',
    'content.review',
  ],
  // "Approved content only": the publish permission is further gated by approval status.
  // ASSUMPTION ASM-09: whoever may publish for a company may also answer its comments and messages.
  publisher: [
    'company.read',
    'brand.read',
    'account.read',
    'content.read',
    'content.publish',
    'inbox.read',
    'inbox.reply',
  ],
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

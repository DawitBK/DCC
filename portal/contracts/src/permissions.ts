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
  // Round 2 (2026-11-26): the working-hours clock, targets and acknowledgement text.
  'inbox.manage',
  // Hide spam and abuse (Content Writer and Digital Marketing Manager, sheet E-14).
  'inbox.moderate',
  // Delete a comment or block a user (Digital Marketing Manager only, E-14).
  'inbox.remove',
  // One designated senior person may let an emergency post through alone (C1-14).
  'content.emergency_approve',
  // The marketing side of the two-person freeze lift (D2-18); the security side is security.manage.
  'publishing.lift_comms',
  // Round 3 (2026-11-26): remove or correct a published post; the roles of its category narrow this further.
  'publication.remove',
  // Round 3: who is alerted by SMS and Teams, and the channel settings (Group CTO, security, Group administrator).
  'alert.manage',
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
    'inbox.manage',
    'incident.read',
    'alert.manage',
    'publication.remove',
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
    'alert.manage',
  ],
  security_admin: [
    ...READ_ALL,
    'security.read',
    'security.manage',
    'incident.read',
    'incident.manage',
    'audit.read',
    'publishing.freeze',
    'alert.manage',
  ],
  // "Approve only" for Group-level announcements.
  group_marketing: [
    ...READ_ALL,
    'content.review',
    'content.approve',
    'content.emergency_approve',
    'publishing.lift_comms',
    'publication.remove',
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
    'inbox.manage',
    'publication.remove',
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
    'publishing.lift_comms',
    'content.emergency_approve',
    'publication.remove',
    'inbox.read',
    'inbox.reply',
    'inbox.manage',
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
    'inbox.manage',
    'inbox.moderate',
    'inbox.remove',
    'publication.remove',
  ],
  // The proposal table shows "publish" in this cell, which reads as a typo for "No".
  // ASSUMPTION ASM-03 (docs/project/ASSUMPTIONS.md): creators cannot publish.
  // Owner decision 2026-11-26 (RQ-030, reverses 2026-11-15 decision 5): the Content Writer reads and answers the
  // inbox of the companies they are assigned to, and hides spam and abuse. A sensitive reply still needs approval.
  content_creator: [
    'company.read',
    'brand.read',
    'account.read',
    'content.read',
    'content.create',
    'content.submit',
    'inbox.read',
    'inbox.reply',
    'inbox.moderate',
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
  // ASSUMPTION ASM-12 (docs/project/ASSUMPTIONS.md): whoever may publish for a company may also answer its comments and messages.
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

import { ROLES, ROLE_LABELS, ROLE_PERMISSIONS, type Permission, type Role } from '@dcc/contracts';

/**
 * One plain sentence for every permission, typed `Record<Permission, ...>`: when a permission is added to
 * `@dcc/contracts` this file stops compiling until it is described. The role table itself is never retyped
 * here: `holdersOf` reads `ROLE_PERMISSIONS`.
 */
export const PERMISSION_TEXT: Record<Permission, { label: string; description: string }> = {
  'company.read': {
    label: 'See companies',
    description: 'Open the list of companies and their details.',
  },
  'company.manage': {
    label: 'Manage companies',
    description: 'Add a company, rename it, suspend or archive it.',
  },
  'brand.read': { label: 'See brands', description: 'Open the brands of a company.' },
  'brand.manage': {
    label: 'Manage brands',
    description: 'Add and rename the brands of a company.',
  },
  'user.read': {
    label: 'See people and roles',
    description: 'Open the list of people and the roles they hold.',
  },
  'user.manage': {
    label: 'Give and remove roles',
    description: 'Give a person a role, or take it away. Asks for a recent sign-in.',
  },
  'account.read': {
    label: 'See social accounts',
    description: 'Open the register of official accounts and the state of the publishing engine.',
  },
  'account.manage': {
    label: 'Manage social accounts',
    description:
      'Register accounts, set owners and backup administrators, link an account to the engine.',
  },
  'content.read': {
    label: 'See content',
    description: 'Open posts, their versions, approvals and publications.',
  },
  'content.create': {
    label: 'Write content',
    description: 'Draft a post, edit it, attach pictures and videos.',
  },
  'content.submit': { label: 'Send for review', description: 'Send a draft to the reviewers.' },
  'content.review': {
    label: 'Review content',
    description: 'Read submitted posts and leave comments.',
  },
  'content.approve': {
    label: 'Approve or reject',
    description: 'Decide on a submitted post. Nobody who wrote a version can decide on it.',
  },
  'content.publish': {
    label: 'Publish',
    description: 'Publish or schedule an approved post, cancel a schedule, check with the engine.',
  },
  'approval_policy.manage': {
    label: 'Set approval rules',
    description:
      'Choose how many people must approve each kind of content, and who may. Asks for a recent sign-in.',
  },
  'publishing.freeze': {
    label: 'Freeze publishing',
    description:
      'Stop all publishing for a company or one account, and lift the freeze. Lifting asks for a recent sign-in.',
  },
  'audit.read': {
    label: 'Read the audit trail',
    description: 'Search, verify and export who did what.',
  },
  'security.read': { label: 'See security', description: 'Open the security center.' },
  'security.manage': {
    label: 'Manage security',
    description: 'Act on what the security center shows.',
  },
  'incident.read': {
    label: 'See incidents',
    description: 'Open incidents, playbooks and recovery contacts.',
  },
  'incident.manage': {
    label: 'Handle incidents',
    description:
      'Report, update and close incidents; keep categories, playbooks and recovery contacts.',
  },
  'report.read': {
    label: 'See reports',
    description: 'Open analytics and the operations overview.',
  },
  'inbox.read': {
    label: 'Read the inbox',
    description: 'Read comments and messages on the accounts.',
  },
  'inbox.reply': {
    label: 'Reply and assign in the inbox',
    description: 'Answer comments and messages and assign them to a colleague.',
  },
  'inbox.manage': {
    label: 'Set the inbox clock',
    description:
      'Set working hours, response targets and the automatic acknowledgement of a company.',
  },
  'inbox.moderate': {
    label: 'Hide spam and abuse',
    description: 'Hide a comment that is spam or abuse. Every action is recorded.',
  },
  'inbox.remove': {
    label: 'Delete comments and block users',
    description: 'Delete a comment or block a user. Every action is recorded.',
  },
  'content.emergency_approve': {
    label: 'Approve an emergency post alone',
    description:
      'Let an emergency post through with one approval; a second person confirms afterwards.',
  },
  'publication.remove': {
    label: 'Remove or correct a published post',
    description:
      'Take a published post down or ask for a correction, with a written reason. The roles of its category decide who may.',
  },
  'alert.manage': {
    label: 'Manage SMS and Teams alerts',
    description:
      'Choose who is alerted by SMS and where the Teams alert goes, and see what was delivered.',
  },
  'publishing.lift_comms': {
    label: 'Confirm lifting a freeze (communications)',
    description:
      'Give the communications confirmation that lifts a freeze after a serious incident.',
  },
};

/** The roles that hold a permission, in the order of `ROLES`. */
export function holdersOf(permission: Permission): Role[] {
  return ROLES.filter((role) => ROLE_PERMISSIONS[role].includes(permission));
}

/** "Company administrator, Group administrator": who could do this, for a hint beside a disabled control. */
export function whoCanText(permission: Permission): string {
  const roles = holdersOf(permission).map((role) => ROLE_LABELS[role]);
  return roles.length ? roles.join(', ') : 'Nobody';
}

/** The sentence to show where a control is not available: "Ask someone who can … (roles)". */
export function needsRoleHint(permission: Permission): string {
  return `${PERMISSION_TEXT[permission].label} needs one of these roles: ${whoCanText(permission)}.`;
}

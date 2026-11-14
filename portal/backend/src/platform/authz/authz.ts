import { ROLE_PERMISSIONS, type Permission, type Role } from '@dcc/contracts';

export interface Membership {
  role: Role;
  groupId: string;
  /** null = group-level: applies to every company of `groupId`. */
  companyId: string | null;
}

/** The caller's effective access, resolved server-side from the database for every request. */
export interface Access {
  userId: string;
  email: string;
  displayName: string;
  memberships: Membership[];
  groupIds: string[];
  companyIds: string[];
}

/** What an action is about. For a company, pass BOTH ids: a group-level role only applies inside its own group. */
export interface Scope {
  groupId: string;
  companyId?: string;
}

/**
 * Does the caller hold `permission` for this scope?
 *  - A company-level role applies only to exactly its company: never to another subsidiary
 *    ("a company administrator never gains access to another subsidiary automatically").
 *  - A group-level role applies to every company of its own group, and to group-level objects.
 * Tenant isolation is enforced separately and independently by PostgreSQL RLS.
 */
export function can(
  access: Pick<Access, 'memberships'>,
  permission: Permission,
  scope: Scope,
): boolean {
  return access.memberships.some((m) => {
    if (!ROLE_PERMISSIONS[m.role].includes(permission)) return false;
    if (m.companyId === null) return m.groupId === scope.groupId;
    return scope.companyId !== undefined && m.companyId === scope.companyId;
  });
}

/** Holds the permission somewhere. Good for "may this person open this area at all"; never enough to act on a specific record. */
export function canAnywhere(access: Pick<Access, 'memberships'>, permission: Permission): boolean {
  return access.memberships.some((m) => ROLE_PERMISSIONS[m.role].includes(permission));
}

/** The union of permissions across the caller's memberships. For showing/hiding UI only. */
export function permissionsOf(access: Pick<Access, 'memberships'>): Permission[] {
  return [...new Set(access.memberships.flatMap((m) => ROLE_PERMISSIONS[m.role]))].sort();
}

/** Where the caller holds `permission`: whole groups and/or single companies. Used to narrow list queries. */
export function scopesWith(
  access: Pick<Access, 'memberships'>,
  permission: Permission,
): { groupIds: string[]; companyIds: string[] } {
  const groupIds = new Set<string>();
  const companyIds = new Set<string>();
  for (const m of access.memberships) {
    if (!ROLE_PERMISSIONS[m.role].includes(permission)) continue;
    if (m.companyId === null) groupIds.add(m.groupId);
    else companyIds.add(m.companyId);
  }
  return { groupIds: [...groupIds], companyIds: [...companyIds] };
}

export class SeparationOfDutiesError extends Error {}

/**
 * The person who creates sensitive content cannot be the one who approves it (proposal 7.3 and 9.1:
 * "reviewer cannot be the creator"). Hirko's approval workflow MUST call this; the rule lives here
 * so there is one definition.
 */
export function assertDifferentPeople(creatorUserId: string, approverUserId: string): void {
  if (creatorUserId === approverUserId) {
    throw new SeparationOfDutiesError('The creator of content cannot also approve it.');
  }
}

/**
 * The full rule for deciding on content: nobody who WROTE any version of an item may review, approve or
 * reject it. Comparing only against the item's first author is not enough: a second person can rewrite
 * the text (a new version) and would then be approving their own words.
 */
export function assertNotAnAuthor(authorUserIds: readonly string[], deciderUserId: string): void {
  if (authorUserIds.includes(deciderUserId)) {
    throw new SeparationOfDutiesError(
      'A person who wrote any version of this content cannot review, approve or reject it.',
    );
  }
}

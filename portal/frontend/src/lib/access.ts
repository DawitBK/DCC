import { roleHasPermission, type MeResponse, type Permission } from '@dcc/contracts';

/**
 * What to SHOW, from `GET /api/me`. This is never protection: the API re-checks every request.
 *
 * `companyId` undefined = "anywhere" (is the screen worth showing at all);
 * a company id = "in that company" (a group-level role counts for every company of the group).
 */
export function canIn(me: MeResponse, permission: Permission, companyId?: string | null): boolean {
  if (companyId === undefined || companyId === null) return me.permissions.includes(permission);
  return me.memberships.some(
    (membership) =>
      (membership.companyId === null || membership.companyId === companyId) &&
      roleHasPermission(membership.role, permission),
  );
}

/** True when a group-level role of this person carries the permission. */
export function canAtGroup(me: MeResponse, permission: Permission): boolean {
  return me.memberships.some(
    (membership) => membership.companyId === null && roleHasPermission(membership.role, permission),
  );
}

export function hasGroupScope(me: MeResponse): boolean {
  return me.memberships.some((membership) => membership.companyId === null);
}

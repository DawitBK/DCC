import type { Transaction } from 'kysely';
import type { Permission } from '@dcc/contracts';
import { scopesWith, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';

/** An id no row has: lets `where company_id in (...)` stay valid (and match nothing) for an empty scope. */
export const NIL = '00000000-0000-0000-0000-000000000000';

/** The tenant context a request runs with, built from the caller's server-resolved access. */
export const ctxOf = (a: Access) => ({
  userId: a.userId,
  groupIds: a.groupIds,
  companyIds: a.companyIds,
});

/**
 * Every company where the caller holds `permission`: their own companies plus every company of any
 * group where they hold it at group level. Use it to narrow list queries; the per-record `can()`
 * check and row-level security still apply on top.
 */
export async function companyIdsWithPermission(
  trx: Transaction<DB>,
  access: Pick<Access, 'memberships'>,
  permission: Permission,
): Promise<string[]> {
  const scope = scopesWith(access, permission);
  const groupCompanies = scope.groupIds.length
    ? (
        await trx
          .selectFrom('companies')
          .select('id')
          .where('group_id', 'in', scope.groupIds)
          .execute()
      ).map((c) => c.id)
    : [];
  return [...new Set([...scope.companyIds, ...groupCompanies])];
}

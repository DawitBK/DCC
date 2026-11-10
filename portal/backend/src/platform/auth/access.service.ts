import { Injectable } from '@nestjs/common';
import { isRole } from '@dcc/contracts';
import type { Access, Membership } from '../authz/authz';
import { TenantDb } from '../tenancy/tenant-db';

export class UserDisabledError extends Error {}

/** Builds the caller's effective access from the database. Called on EVERY request: nothing is cached or trusted from the session. */
@Injectable()
export class AccessService {
  constructor(private readonly tenant: TenantDb) {}

  async resolve(userId: string): Promise<Access | null> {
    return this.tenant.runAsUser(userId, async (trx) => {
      // RLS lets the caller read exactly their own user row and their own memberships.
      const user = await trx
        .selectFrom('users')
        .select(['id', 'email', 'display_name', 'status'])
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!user) return null;
      if (user.status !== 'active') throw new UserDisabledError();

      const rows = await trx
        .selectFrom('memberships')
        .select(['role', 'group_id', 'company_id'])
        .where('user_id', '=', userId)
        .execute();

      const memberships: Membership[] = rows
        .filter((r) => isRole(r.role))
        .map((r) => ({
          role: r.role as Membership['role'],
          groupId: r.group_id,
          companyId: r.company_id,
        }));

      return {
        userId: user.id,
        email: user.email,
        displayName: user.display_name,
        memberships,
        groupIds: [
          ...new Set(memberships.filter((m) => m.companyId === null).map((m) => m.groupId)),
        ],
        companyIds: [...new Set(memberships.flatMap((m) => (m.companyId ? [m.companyId] : [])))],
      };
    });
  }
}

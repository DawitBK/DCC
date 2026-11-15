import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { isRole, ROLES, type Role } from '@dcc/contracts';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import type { Access, Membership } from '../authz/authz';
import { TenantDb } from '../tenancy/tenant-db';

export class UserDisabledError extends Error {}

/** Builds the caller's effective access from the database. Called on EVERY request: nothing is cached or trusted from the session. */
@Injectable()
export class AccessService {
  constructor(
    private readonly tenant: TenantDb,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** True for an address named in DCC_PLATFORM_OWNER_EMAILS. Other modules use it to keep the owner out of people lists. */
  isPlatformOwnerEmail(email: string): boolean {
    return this.cfg.DCC_PLATFORM_OWNER_EMAILS.includes(email.toLowerCase());
  }

  /**
   * `actingRole`: the role the person chose for this session, or null for all their roles together.
   * A role they do not hold (any more) is ignored, so a revoked role cannot linger in a session.
   */
  async resolve(userId: string, actingRole: string | null = null): Promise<Access | null> {
    return this.tenant.runAsUser(userId, async (trx) => {
      // RLS lets the caller read exactly their own user row and their own memberships.
      const user = await trx
        .selectFrom('users')
        .select(['id', 'email', 'display_name', 'status'])
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!user) return null;
      if (user.status !== 'active') throw new UserDisabledError();

      const isPlatformOwner = this.isPlatformOwnerEmail(user.email);
      let all: Membership[];
      if (isPlatformOwner) {
        // The platform owner holds every role in every group. Nothing is stored: there is no
        // membership row to list, change or remove, and removing the address from the
        // configuration ends it at the next request.
        const groups = await sql<{ id: string }>`select platform_all_group_ids() as id`.execute(
          trx,
        );
        all = groups.rows.flatMap((g) =>
          ROLES.map((role) => ({ role, groupId: g.id, companyId: null })),
        );
      } else {
        const rows = await trx
          .selectFrom('memberships')
          .select(['role', 'group_id', 'company_id'])
          .where('user_id', '=', userId)
          .execute();
        all = rows
          .filter((r) => isRole(r.role))
          .map((r) => ({
            role: r.role as Membership['role'],
            groupId: r.group_id,
            companyId: r.company_id,
          }));
      }

      const heldRoles = ROLES.filter((r) => all.some((m) => m.role === r));
      const acting: Role | null =
        actingRole !== null && isRole(actingRole) && heldRoles.includes(actingRole)
          ? actingRole
          : null;
      const memberships = acting ? all.filter((m) => m.role === acting) : all;

      return {
        userId: user.id,
        email: user.email,
        displayName: user.display_name,
        memberships,
        groupIds: [
          ...new Set(memberships.filter((m) => m.companyId === null).map((m) => m.groupId)),
        ],
        companyIds: [...new Set(memberships.flatMap((m) => (m.companyId ? [m.companyId] : [])))],
        heldRoles,
        actingRole: acting,
        isPlatformOwner,
      };
    });
  }
}

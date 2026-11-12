import { Injectable } from '@nestjs/common';
import type { DashboardDto, Permission } from '@dcc/contracts';
import { scopesWith, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { ctxOf } from '../shared/tenant-scope';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Home-screen numbers (proposal 7.1 "Group dashboard", Figure 2). Every section is limited to the
 * companies where the caller holds the permission that section needs, and is null when they hold it
 * nowhere. Internal counts only - nothing here pretends to be engagement analytics.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly tenant: TenantDb) {}

  async get(access: Access): Promise<DashboardDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companies = await trx.selectFrom('companies').select(['id', 'group_id']).execute();
      const idsFor = (permission: Permission): string[] | null => {
        const scope = scopesWith(access, permission);
        if (!scope.groupIds.length && !scope.companyIds.length) return null;
        const ids = new Set(scope.companyIds);
        for (const c of companies) if (scope.groupIds.includes(c.group_id)) ids.add(c.id);
        return [...ids];
      };
      const count = (n: string | number | bigint | undefined) => Number(n ?? 0);

      const accountIds = idsFor('account.read');
      let accounts: DashboardDto['accounts'] = null;
      if (accountIds) {
        const rows = accountIds.length
          ? await trx
              .selectFrom('social_accounts')
              .select('status')
              .select((eb) => eb.fn.countAll().as('count'))
              .where('company_id', 'in', accountIds)
              .where('status', '!=', 'archived')
              .groupBy('status')
              .execute()
          : [];
        const of = (s: string) => count(rows.find((r) => r.status === s)?.count);
        accounts = {
          total: rows.reduce((sum, r) => sum + count(r.count), 0),
          active: of('active'),
          needsAttention: of('needs_attention'),
        };
      }

      const reviewIds = idsFor('content.review');
      const pendingApprovals = reviewIds
        ? count(
            reviewIds.length
              ? (
                  await trx
                    .selectFrom('approval_requests')
                    .select((eb) => eb.fn.countAll().as('count'))
                    .where('company_id', 'in', reviewIds)
                    .where('status', '=', 'pending')
                    .executeTakeFirst()
                )?.count
              : 0,
          )
        : null;

      const contentIds = idsFor('content.read');
      const publishedLast7Days = contentIds
        ? count(
            contentIds.length
              ? (
                  await trx
                    .selectFrom('publications')
                    .select((eb) => eb.fn.countAll().as('count'))
                    .where('company_id', 'in', contentIds)
                    .where('status', '=', 'published')
                    .where('completed_at', '>=', new Date(Date.now() - WEEK_MS))
                    .executeTakeFirst()
                )?.count
              : 0,
          )
        : null;

      const incidentIds = idsFor('incident.read');
      const openIncidents = incidentIds
        ? count(
            incidentIds.length
              ? (
                  await trx
                    .selectFrom('incidents')
                    .select((eb) => eb.fn.countAll().as('count'))
                    .where('company_id', 'in', incidentIds)
                    .where('status', 'in', ['open', 'investigating'])
                    .executeTakeFirst()
                )?.count
              : 0,
          )
        : null;

      const unread = await trx
        .selectFrom('notifications')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('read_at', 'is', null)
        .executeTakeFirst();

      return {
        accounts,
        pendingApprovals,
        publishedLast7Days,
        openIncidents,
        unreadNotifications: count(unread?.count),
      };
    });
  }
}

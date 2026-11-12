import { Injectable } from '@nestjs/common';
import type { OperationsOverviewDto } from '@dcc/contracts';
import { scopesWith, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';

const NIL = '00000000-0000-0000-0000-000000000000';
const ctxOf = (a: Access) => ({ userId: a.userId, groupIds: a.groupIds, companyIds: a.companyIds });

type CountRow = { company_id: string; status: string; count: string | number | bigint };
const byStatus = (rows: CountRow[], companyId: string) => {
  const forCompany = rows.filter((r) => r.company_id === companyId);
  const result: Record<string, number> = {};
  let total = 0;
  for (const r of forCompany) {
    const n = Number(r.count);
    result[r.status] = n;
    total += n;
  }
  return { total, byStatus: result };
};

/**
 * Internal operations counts only (H-06, "reports" per the module plan) - NOT the engagement/reach/
 * follower analytics the proposal describes, which need the operational engine (not connected yet,
 * Woluman's work). Built this way rather than guessed to avoid overclaiming what exists.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly tenant: TenantDb) {}

  async overview(access: Access): Promise<OperationsOverviewDto[]> {
    const scope = scopesWith(access, 'report.read');
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companies = await trx
        .selectFrom('companies')
        .select(['id', 'name', 'group_id'])
        .execute();
      const groupCompanyIds = companies
        .filter((c) => scope.groupIds.includes(c.group_id))
        .map((c) => c.id);
      const companyIds = [...new Set([...scope.companyIds, ...groupCompanyIds])];
      const scoped = companies.filter((c) => companyIds.includes(c.id));
      if (!scoped.length) return [];

      const accounts = await trx
        .selectFrom('social_accounts')
        .select(['company_id', 'status'])
        .select((eb) => eb.fn.countAll().as('count'))
        .where('company_id', 'in', companyIds)
        .groupBy(['company_id', 'status'])
        .execute();
      const content = await trx
        .selectFrom('content_items')
        .select(['company_id', 'status'])
        .select((eb) => eb.fn.countAll().as('count'))
        .where('company_id', 'in', companyIds)
        .groupBy(['company_id', 'status'])
        .execute();
      const publications = await trx
        .selectFrom('publications')
        .select(['company_id', 'status'])
        .select((eb) => eb.fn.countAll().as('count'))
        .where('company_id', 'in', companyIds.length ? companyIds : [NIL])
        .groupBy(['company_id', 'status'])
        .execute();

      return scoped.map((c) => ({
        companyId: c.id,
        companyName: c.name,
        socialAccounts: byStatus(accounts, c.id),
        contentItems: byStatus(content, c.id),
        publications: byStatus(publications, c.id),
      }));
    });
  }
}

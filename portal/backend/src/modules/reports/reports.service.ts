import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AnalyticsQuery,
  AnalyticsReportDto,
  OperationsOverviewDto,
  RegistryGapDto,
} from '@dcc/contracts';
import { supportsAnalytics, type OperationalEngine } from '@dcc/engine-client';
import { Inject } from '@nestjs/common';
import { scopesWith, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';
import { OPERATIONAL_ENGINE } from '../publishing/operational-engine.provider';

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

type AnalyticsTarget = {
  companyId: string;
  socialAccountId: string;
  displayName: string;
  platform: string;
  engineChannelId: string | null;
  publicationId?: string;
  engineOperationId?: string | null;
};

/**
 * Internal operations counts only (H-06, "reports" per the module plan) - NOT the engagement/reach/
 * follower analytics the proposal describes, which need the operational engine (not connected yet,
 * Woluman's work). Built this way rather than guessed to avoid overclaiming what exists.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly tenant: TenantDb,
    @Inject(OPERATIONAL_ENGINE) private readonly engine: OperationalEngine,
  ) {}

  async analytics(access: Access, query: AnalyticsQuery): Promise<AnalyticsReportDto[]> {
    const targets: AnalyticsTarget[] = await this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'report.read');
      if (query.publicationId) {
        const publication = await trx
          .selectFrom('publications as p')
          .innerJoin('social_accounts as a', 'a.id', 'p.social_account_id')
          .select([
            'p.id as publicationId',
            'p.company_id as companyId',
            'a.id as socialAccountId',
            'a.display_name as displayName',
            'a.platform',
            'a.engine_channel_id as engineChannelId',
            'p.engine_operation_id as engineOperationId',
          ])
          .where('p.id', '=', query.publicationId)
          .where('p.company_id', 'in', companyIds.length ? companyIds : [NIL])
          .executeTakeFirst();
        if (!publication) throw new NotFoundException('Publication not found.');
        if (!publication.engineOperationId)
          throw new NotFoundException('This publication has no engine operation yet.');
        return [publication];
      }
      return trx
        .selectFrom('social_accounts as a')
        .select([
          'a.id as socialAccountId',
          'a.company_id as companyId',
          'a.display_name as displayName',
          'a.platform',
          'a.engine_channel_id as engineChannelId',
        ])
        .where('a.company_id', 'in', companyIds.length ? companyIds : [NIL])
        .where('a.engine_channel_id', 'is not', null)
        .$if(query.socialAccountId !== undefined, (builder) =>
          builder.where('a.id', '=', query.socialAccountId!),
        )
        .orderBy('a.display_name', 'asc')
        .execute();
    });
    const analyticsEngine = supportsAnalytics(this.engine) ? this.engine : null;
    if (!analyticsEngine)
      throw new BadGatewayException('The operational engine does not provide analytics.');
    return Promise.all(
      targets.map(async (target) => {
        const result = target.engineOperationId
          ? await analyticsEngine.postAnalytics(target.engineOperationId, query.days)
          : await analyticsEngine.channelAnalytics(target.engineChannelId!, query.days);
        return {
          companyId: target.companyId,
          socialAccountId: target.socialAccountId,
          displayName: target.displayName,
          platform: target.platform as AnalyticsReportDto['platform'],
          publicationId: target.publicationId ?? null,
          result,
        };
      }),
    );
  }

  async registryGaps(access: Access): Promise<RegistryGapDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'report.read');
      if (!companyIds.length) return [];
      const rows = await trx
        .selectFrom('social_accounts')
        .select([
          'id',
          'company_id',
          'platform',
          'display_name',
          'handle',
          'status',
          'owner_user_id',
          'backup_admin_user_id',
          'engine_channel_id',
        ])
        .where('company_id', 'in', companyIds)
        .where('status', '!=', 'archived')
        .orderBy('display_name', 'asc')
        .execute();
      const gaps: RegistryGapDto[] = [];
      for (const r of rows) {
        const missing: RegistryGapDto['missing'] = [];
        if (!r.owner_user_id) missing.push('owner');
        if (!r.backup_admin_user_id) missing.push('backup_admin');
        if (!r.engine_channel_id) missing.push('engine_channel');
        if (!missing.length && r.status === 'active') continue;
        gaps.push({
          socialAccountId: r.id,
          companyId: r.company_id,
          platform: r.platform as RegistryGapDto['platform'],
          displayName: r.display_name,
          handle: r.handle,
          status: r.status,
          missing,
        });
      }
      return gaps;
    });
  }

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

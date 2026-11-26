import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AnalyticsQuery,
  ApprovalMissesDto,
  AnalyticsReportDto,
  AnalyticsResultDto,
  OperationsOverviewDto,
  RegistryGapDto,
} from '@dcc/contracts';
import {
  EngineRejectedError,
  EngineUnsupportedError,
  type AnalyticsEngine,
} from '@dcc/engine-client';
import { Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { scopesWith, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';
import { ANALYTICS_ENGINE } from '../publishing/operational-engine.provider';

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
    @Inject(ANALYTICS_ENGINE) private readonly analyticsEngine: AnalyticsEngine | null,
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
    const analyticsEngine = this.analyticsEngine;
    if (!analyticsEngine)
      throw new BadGatewayException('The operational engine does not provide analytics.');
    return Promise.all(
      targets.map(async (target) => {
        // One account that the engine cannot answer must not fail the others: it is shown as
        // unavailable with a short reason, never as zero (D-24).
        const result: AnalyticsResultDto = await (
          target.engineOperationId
            ? analyticsEngine.postAnalytics(target.engineOperationId, query.days)
            : analyticsEngine.channelAnalytics(target.engineChannelId!, query.days)
        ).catch((error: unknown): AnalyticsResultDto => ({
          status: 'unavailable',
          windowDays: query.days,
          series: [],
          reason:
            error instanceof EngineRejectedError
              ? `The engine refused the request (${error.status}).`
              : error instanceof EngineUnsupportedError
                ? 'The engine does not provide analytics for this account.'
                : 'The engine could not be reached.',
        }));
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

  /**
   * Round 2 (C1-11, C1-14): approvals that reached the last step of their escalation ladder, and emergency
   * approvals still unconfirmed 48 hours later, per company and month (the company's own time), for the monthly
   * executive report. `month` (`YYYY-MM`) narrows it to one month. Only companies where the caller holds report.read.
   */
  async approvalMisses(access: Access, month?: string): Promise<ApprovalMissesDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'report.read');
      if (!companyIds.length) return [];
      // The last level of the ladder: 4 (200%), or 3 for a crisis-sized limit (round the clock, an hour or less).
      const { rows } = await sql<{
        company_id: string;
        month: string;
        approval_misses: string;
        emergency_misses: string;
      }>`
        select e.company_id,
               to_char(e.created_at + make_interval(mins => coalesce(w.utc_offset_minutes, 180)), 'YYYY-MM') as month,
               count(*) filter (where e.kind = 'approval') as approval_misses,
               count(*) filter (where e.kind = 'emergency_followup') as emergency_misses
          from escalation_events e
          left join company_working_hours w on w.company_id = e.company_id
          left join approval_requests r on r.id = e.target_id
         where e.company_id in (${sql.join(companyIds)})
           and (
             (e.kind = 'approval' and r.id is not null and e.level =
                case when r.clock = 'continuous' and coalesce(r.time_limit_hours, 0) <= 1 then 3 else 4 end)
             or (e.kind = 'emergency_followup' and e.level = 2)
           )
         group by 1, 2
         order by 2 desc, 1`.execute(trx);
      return rows
        .filter((r) => !month || r.month === month)
        .map((r) => ({
          companyId: r.company_id,
          month: r.month,
          approvalMisses: Number(r.approval_misses),
          emergencyFollowupMisses: Number(r.emergency_misses),
        }));
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

      // Incident numbers only for the companies where the caller may read incidents (report.read alone is not enough).
      const incidentCompanyIds = (
        await companyIdsWithPermission(trx, access, 'incident.read')
      ).filter((id) => companyIds.includes(id));
      const incidents = incidentCompanyIds.length
        ? await trx
            .selectFrom('incidents')
            .select(['company_id', 'status'])
            .select((eb) => eb.fn.countAll().as('count'))
            .where('company_id', 'in', incidentCompanyIds)
            .groupBy(['company_id', 'status'])
            .execute()
        : [];

      return scoped.map((c) => ({
        companyId: c.id,
        companyName: c.name,
        socialAccounts: byStatus(accounts, c.id),
        contentItems: byStatus(content, c.id),
        publications: byStatus(publications, c.id),
        incidents: incidentCompanyIds.includes(c.id) ? byStatus(incidents, c.id) : null,
      }));
    });
  }
}

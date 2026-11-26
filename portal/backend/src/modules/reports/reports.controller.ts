import { Controller, Get, Query } from '@nestjs/common';
import {
  AnalyticsQuery,
  InboxMissesQuery,
  type AnalyticsReportDto,
  type InboxMissReportDto,
  type OperationsOverviewDto,
  type RegistryGapDto,
} from '@dcc/contracts';
import type { z } from 'zod';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { ReportsService } from './reports.service';

/** Internal operations counts, not the engagement/reach analytics the proposal describes
 * (needs the operational engine - not connected yet). See docs/api/reports.md. */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('overview')
  @RequirePermission('report.read')
  overview(@CurrentAccess() access: Access): Promise<OperationsOverviewDto[]> {
    return this.reports.overview(access);
  }

  /** Accounts missing an owner, a backup admin or an engine connection, or needing attention. */
  @Get('registry-gaps')
  @RequirePermission('report.read')
  registryGaps(@CurrentAccess() access: Access): Promise<RegistryGapDto[]> {
    return this.reports.registryGaps(access);
  }

  /** Round 2: inbox messages that reached 200% of their response target, per company and month. */
  @Get('inbox-misses')
  @RequirePermission('report.read')
  inboxMisses(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(InboxMissesQuery)) query: z.infer<typeof InboxMissesQuery>,
  ): Promise<InboxMissReportDto[]> {
    return this.reports.inboxMisses(access, query);
  }

  @Get('analytics')
  @RequirePermission('report.read')
  analytics(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(AnalyticsQuery)) query: z.infer<typeof AnalyticsQuery>,
  ): Promise<AnalyticsReportDto[]> {
    return this.reports.analytics(access, query);
  }
}

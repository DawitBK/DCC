import { Controller, Get, Query } from '@nestjs/common';
import {
  AnalyticsQuery,
  type ApprovalMissesDto,
  type AnalyticsReportDto,
  type OperationsOverviewDto,
  type RegistryGapDto,
} from '@dcc/contracts';
import { z } from 'zod';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { ReportsService } from './reports.service';

const MissesQuery = z.object({
  month: z
    .string()
    .regex(/^d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});

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

  @Get('analytics')
  @RequirePermission('report.read')
  analytics(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(AnalyticsQuery)) query: z.infer<typeof AnalyticsQuery>,
  ): Promise<AnalyticsReportDto[]> {
    return this.reports.analytics(access, query);
  }

  /** Round 2: escalations missed per company and month (approvals and emergency confirmations). */
  @Get('approval-misses')
  @RequirePermission('report.read')
  approvalMisses(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(MissesQuery)) query: z.infer<typeof MissesQuery>,
  ): Promise<ApprovalMissesDto[]> {
    return this.reports.approvalMisses(access, query.month);
  }
}

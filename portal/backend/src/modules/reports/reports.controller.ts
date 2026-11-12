import { Controller, Get } from '@nestjs/common';
import type { OperationsOverviewDto, RegistryGapDto } from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess } from '../../platform/http/http-support';
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
}

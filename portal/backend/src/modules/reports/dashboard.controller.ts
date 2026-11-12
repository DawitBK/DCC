import { Controller, Get } from '@nestjs/common';
import type { DashboardDto } from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { CurrentAccess } from '../../platform/http/http-support';
import { DashboardService } from './dashboard.service';

/** No @RequirePermission on purpose: it is everyone's home screen; each section is permission-scoped inside the service. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentAccess() access: Access): Promise<DashboardDto> {
    return this.dashboard.get(access);
  }
}

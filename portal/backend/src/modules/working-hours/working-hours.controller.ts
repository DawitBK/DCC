import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { SetWorkingHoursRequest, type WorkingHoursDto } from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { WorkingHoursService } from './working-hours.service';

const CompanyQuery = z.object({ companyId: z.uuid() });

/** Round 2: the working calendar the response and approval clocks count in. */
@Controller('working-hours')
export class WorkingHoursController {
  constructor(private readonly hours: WorkingHoursService) {}

  @Get()
  @RequirePermission('company.read')
  get(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(CompanyQuery)) q: z.infer<typeof CompanyQuery>,
  ): Promise<WorkingHoursDto> {
    return this.hours.get(access, q.companyId);
  }

  @Put()
  @RequirePermission('inbox.manage')
  set(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(SetWorkingHoursRequest)) body: SetWorkingHoursRequest,
  ): Promise<WorkingHoursDto> {
    return this.hours.set(access, body);
  }
}

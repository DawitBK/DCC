import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CreateIncidentRequest, UpdateIncidentRequest, type IncidentDto } from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { IncidentsService } from './incidents.service';

/** H-06, first cut: register, track and resolve an incident. */
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @RequirePermission('incident.read')
  list(@CurrentAccess() access: Access): Promise<IncidentDto[]> {
    return this.incidents.list(access);
  }

  @Get(':id')
  @RequirePermission('incident.read')
  get(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IncidentDto> {
    return this.incidents.get(access, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('incident.manage')
  create(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(CreateIncidentRequest)) body: CreateIncidentRequest,
  ): Promise<IncidentDto> {
    return this.incidents.create(access, body);
  }

  @Patch(':id')
  @RequirePermission('incident.manage')
  update(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateIncidentRequest)) body: UpdateIncidentRequest,
  ): Promise<IncidentDto> {
    return this.incidents.update(access, id, body);
  }
}

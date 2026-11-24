import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CreateIncidentCategoryRequest,
  CreateIncidentContactRequest,
  UpdateIncidentCategoryRequest,
  UpdateIncidentContactRequest,
  type IncidentCategoryDto,
  type IncidentContactDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { IncidentDetailService } from './incident-detail.service';

const CompanyQuery = z.object({ companyId: z.uuid().optional() });

/** H-06 incident detail: incident categories with an optional playbook, and recovery contacts per company. */
@Controller()
export class IncidentDetailController {
  constructor(private readonly detail: IncidentDetailService) {}

  @Get('incident-categories')
  @RequirePermission('incident.read')
  listCategories(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(CompanyQuery)) q: z.infer<typeof CompanyQuery>,
  ): Promise<IncidentCategoryDto[]> {
    return this.detail.listCategories(access, q.companyId);
  }

  @Post('incident-categories')
  @HttpCode(201)
  @RequirePermission('incident.manage')
  createCategory(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(CreateIncidentCategoryRequest)) body: CreateIncidentCategoryRequest,
  ): Promise<IncidentCategoryDto> {
    return this.detail.createCategory(access, body);
  }

  @Patch('incident-categories/:id')
  @RequirePermission('incident.manage')
  updateCategory(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateIncidentCategoryRequest)) body: UpdateIncidentCategoryRequest,
  ): Promise<IncidentCategoryDto> {
    return this.detail.updateCategory(access, id, body);
  }

  @Get('incident-contacts')
  @RequirePermission('incident.read')
  listContacts(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(CompanyQuery)) q: z.infer<typeof CompanyQuery>,
  ): Promise<IncidentContactDto[]> {
    return this.detail.listContacts(access, q.companyId);
  }

  @Post('incident-contacts')
  @HttpCode(201)
  @RequirePermission('incident.manage')
  createContact(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(CreateIncidentContactRequest)) body: CreateIncidentContactRequest,
  ): Promise<IncidentContactDto> {
    return this.detail.createContact(access, body);
  }

  @Patch('incident-contacts/:id')
  @RequirePermission('incident.manage')
  updateContact(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateIncidentContactRequest)) body: UpdateIncidentContactRequest,
  ): Promise<IncidentContactDto> {
    return this.detail.updateContact(access, id, body);
  }
}

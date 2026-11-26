import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AlertDeliveriesQuery,
  AlertGroupQuery,
  SetAlertContactRequest,
  SetAlertSettingsRequest,
  TestAlertRequest,
  type AlertContactResultDto,
  type AlertContactsDto,
  type AlertDeliveryDto,
  type AlertSettingsDto,
  type AlertStatusDto,
  type AlertTestResultDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { AlertsService } from './alerts.service';

/**
 * RQ-029: SMS, Teams and e-mail alerts for SEV1 and SEV2 incidents.
 *
 * `settings` and `deliveries` need `alert.manage`. `contacts`, `test` and `status` carry NO @RequirePermission on purpose:
 * a person's own mobile number is theirs to keep, whatever their role (the same reasoning as the personal notifications
 * inbox). The service still checks, per group, who may see or set whose number, and answers 403 to a person with no
 * membership at all.
 */
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('status')
  status(@CurrentAccess() access: Access): AlertStatusDto {
    return this.alerts.status(access);
  }

  @Get('settings')
  @RequirePermission('alert.manage')
  getSettings(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(AlertGroupQuery)) q: z.infer<typeof AlertGroupQuery>,
  ): Promise<AlertSettingsDto> {
    return this.alerts.getSettings(access, q.groupId);
  }

  @Put('settings')
  @HttpCode(200)
  @RequirePermission('alert.manage')
  setSettings(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(AlertGroupQuery)) q: z.infer<typeof AlertGroupQuery>,
    @Body(new ZodValidationPipe(SetAlertSettingsRequest)) body: SetAlertSettingsRequest,
  ): Promise<AlertSettingsDto> {
    return this.alerts.setSettings(access, q.groupId, body);
  }

  @Get('contacts')
  listContacts(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(AlertGroupQuery)) q: z.infer<typeof AlertGroupQuery>,
  ): Promise<AlertContactsDto> {
    return this.alerts.listContacts(access, q.groupId);
  }

  /** Sets a contact, or removes it with `mobile: null`. Answers `{ contact }`, with `contact: null` after a removal. */
  @Put('contacts')
  @HttpCode(200)
  setContact(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(SetAlertContactRequest)) body: SetAlertContactRequest,
  ): Promise<AlertContactResultDto> {
    return this.alerts.setContact(access, body);
  }

  @Get('deliveries')
  @RequirePermission('alert.manage')
  listDeliveries(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(AlertDeliveriesQuery)) q: z.infer<typeof AlertDeliveriesQuery>,
  ): Promise<AlertDeliveryDto[]> {
    return this.alerts.listDeliveries(access, q);
  }

  @Post('test')
  @HttpCode(200)
  test(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(TestAlertRequest)) body: TestAlertRequest,
  ): Promise<AlertTestResultDto> {
    return this.alerts.test(access, body);
  }
}

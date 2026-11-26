import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ConfirmFreezeLiftRequest,
  CreateFreezeWithIncidentRequest,
  type FreezeLiftResultDto,
  type FreezeWithLiftDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission, RequireRecentAuth } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { FreezeService } from './freeze.service';

/** H-05 (FR-15): the emergency freeze switch, per company or per account. Round 2: the two-person lift (D2-17, D2-18). */
@Controller('publishing-freezes')
export class FreezeController {
  constructor(private readonly freezes: FreezeService) {}

  @Get()
  @RequirePermission('publishing.freeze')
  list(@CurrentAccess() access: Access): Promise<FreezeWithLiftDto[]> {
    return this.freezes.list(access);
  }

  /** The communications side holds no freeze permission, yet is asked to confirm lifting: it sees the freezes of its companies here. */
  @Get('for-communications')
  @RequirePermission('publishing.lift_comms')
  listForCommunications(@CurrentAccess() access: Access): Promise<FreezeWithLiftDto[]> {
    return this.freezes.list(access, 'publishing.lift_comms');
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('publishing.freeze')
  freeze(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(CreateFreezeWithIncidentRequest))
    body: CreateFreezeWithIncidentRequest,
  ): Promise<FreezeWithLiftDto> {
    return this.freezes.freeze(access, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('publishing.freeze')
  // Freezing is the emergency brake and must be instant; LIFTING it is the sensitive direction.
  @RequireRecentAuth()
  unfreeze(@CurrentAccess() access: Access, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.freezes.unfreeze(access, id);
  }

  // Two-person lift. Each side has its own route because each side needs its own permission.
  @Post(':id/lift-confirmations/security')
  @HttpCode(200)
  @RequirePermission('security.manage')
  @RequireRecentAuth()
  confirmSecurity(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmFreezeLiftRequest)) body: ConfirmFreezeLiftRequest,
  ): Promise<FreezeLiftResultDto> {
    return this.freezes.confirmLift(access, id, 'security', body);
  }

  @Post(':id/lift-confirmations/communications')
  @HttpCode(200)
  @RequirePermission('publishing.lift_comms')
  @RequireRecentAuth()
  confirmCommunications(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmFreezeLiftRequest)) body: ConfirmFreezeLiftRequest,
  ): Promise<FreezeLiftResultDto> {
    return this.freezes.confirmLift(access, id, 'communications', body);
  }

  @Delete(':id/lift-confirmations/security')
  @HttpCode(200)
  @RequirePermission('security.manage')
  withdrawSecurity(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FreezeWithLiftDto> {
    return this.freezes.withdrawLift(access, id, 'security');
  }

  @Delete(':id/lift-confirmations/communications')
  @HttpCode(200)
  @RequirePermission('publishing.lift_comms')
  withdrawCommunications(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FreezeWithLiftDto> {
    return this.freezes.withdrawLift(access, id, 'communications');
  }
}

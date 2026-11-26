import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ApproveAckRequest, SetAckSettingsRequest, type AckSettingsDto } from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { InboxAckService } from './inbox-ack.service';

const AckQuery = z.object({ companyId: z.uuid() });

/** Round 2, E-13: the acknowledgement text. Written by `inbox.manage`, approved by a different holder of `content.approve`. */
@Controller('inbox/acknowledgement')
export class InboxAckController {
  constructor(private readonly ack: InboxAckService) {}

  @Get()
  @RequirePermission('inbox.read')
  get(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(AckQuery)) q: z.infer<typeof AckQuery>,
  ): Promise<AckSettingsDto> {
    return this.ack.get(access, q.companyId);
  }

  @Put()
  @RequirePermission('inbox.manage')
  set(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(SetAckSettingsRequest)) body: SetAckSettingsRequest,
  ): Promise<AckSettingsDto> {
    return this.ack.set(access, body);
  }

  @Post('approve')
  @HttpCode(200)
  @RequirePermission('content.approve')
  approve(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(ApproveAckRequest)) body: ApproveAckRequest,
  ): Promise<AckSettingsDto> {
    return this.ack.approve(access, body);
  }
}

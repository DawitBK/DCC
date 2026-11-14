import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { InboxQuery, ReplyInboxRequest, type InboxMessageDto } from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { InboxService } from './inbox.service';

/** FR-13: the unified inbox, read through the operational engine. */
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @RequirePermission('inbox.read')
  list(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(InboxQuery)) q: z.infer<typeof InboxQuery>,
  ): Promise<InboxMessageDto[]> {
    return this.inbox.list(access, q);
  }

  @Post('reply')
  @HttpCode(201)
  @RequirePermission('inbox.reply')
  reply(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(ReplyInboxRequest)) body: ReplyInboxRequest,
  ): Promise<{ sent: true }> {
    return this.inbox.reply(access, body);
  }
}

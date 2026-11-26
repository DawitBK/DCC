import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  HideMessageRequest,
  ModerationQuery,
  RemoveMessageRequest,
  type ModerationActionDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { InboxModerationService } from './inbox-moderation.service';

/** Round 2, E-14: hide needs `inbox.moderate`; delete and block need `inbox.remove` and a written reason. */
@Controller('inbox/moderation')
export class InboxModerationController {
  constructor(private readonly moderation: InboxModerationService) {}

  @Post('hide')
  @HttpCode(201)
  @RequirePermission('inbox.moderate')
  hide(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(HideMessageRequest)) body: HideMessageRequest,
  ): Promise<ModerationActionDto> {
    return this.moderation.hide(access, body);
  }

  @Post('delete')
  @HttpCode(201)
  @RequirePermission('inbox.remove')
  delete(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(RemoveMessageRequest)) body: RemoveMessageRequest,
  ): Promise<ModerationActionDto> {
    return this.moderation.delete(access, body);
  }

  @Post('block')
  @HttpCode(201)
  @RequirePermission('inbox.remove')
  block(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(RemoveMessageRequest)) body: RemoveMessageRequest,
  ): Promise<ModerationActionDto> {
    return this.moderation.block(access, body);
  }

  /** The record of what was hidden, deleted or blocked. */
  @Get()
  @RequirePermission('inbox.moderate')
  list(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(ModerationQuery)) q: ModerationQuery,
  ): Promise<ModerationActionDto[]> {
    return this.moderation.list(access, q);
  }
}

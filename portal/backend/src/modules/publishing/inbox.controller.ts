import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AssignInboxMessageRequest,
  InboxQuery,
  ReplyInboxRequest,
  SetInboxSettingsRequest,
  type InboxAssigneeDto,
  type InboxAssignmentDto,
  type InboxMessageDto,
  type InboxSettingsDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { InboxSettingsService } from './inbox-settings.service';
import { InboxService } from './inbox.service';

const AssigneesQuery = z.object({ companyId: z.uuid() });

/** FR-13: the unified inbox, read through the operational engine. */
@Controller('inbox')
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly settings: InboxSettingsService,
  ) {}

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

  /** H-14: assign a message to a person who may reply for its company, or clear it (`assigneeUserId: null`). */
  @Put('assignment')
  @RequirePermission('inbox.reply')
  assign(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(AssignInboxMessageRequest)) body: AssignInboxMessageRequest,
  ): Promise<InboxAssignmentDto> {
    return this.inbox.assign(access, body);
  }

  /** H-14: the people a message of this company can be assigned to. */
  @Get('assignees')
  @RequirePermission('inbox.reply')
  assignees(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(AssigneesQuery)) q: z.infer<typeof AssigneesQuery>,
  ): Promise<InboxAssigneeDto[]> {
    return this.inbox.assignees(access, q.companyId);
  }

  /** H-14: the response-time target of each company the caller may read the inbox of. */
  @Get('settings')
  @RequirePermission('inbox.read')
  listSettings(@CurrentAccess() access: Access): Promise<InboxSettingsDto[]> {
    return this.settings.list(access);
  }

  /** H-14: set or clear (`null`) a company's response-time target. Needs `approval_policy.manage` for the company. */
  @Put('settings')
  @RequirePermission('approval_policy.manage')
  setSettings(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(SetInboxSettingsRequest)) body: SetInboxSettingsRequest,
  ): Promise<InboxSettingsDto> {
    return this.settings.set(access, body);
  }
}

import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AssignInboxMessageRequest,
  ClaimInboxMessageRequest,
  InboxQuery,
  ReplyInboxRequest,
  SetInboxClockSettingsRequest,
  SetInboxPriorityRequest,
  type InboxAssigneeDto,
  type InboxAssignmentDto,
  type InboxRoutedMessageDto,
  type InboxClockSettingsDto,
  type InboxPriorityDto,
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
  ): Promise<InboxRoutedMessageDto[]> {
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

  /** Round 3 (E-03): take an unassigned message for yourself. 409 when someone has it already or it was answered. */
  @Post('claim')
  @HttpCode(200)
  @RequirePermission('inbox.reply')
  claim(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(ClaimInboxMessageRequest)) body: ClaimInboxMessageRequest,
  ): Promise<InboxAssignmentDto> {
    return this.inbox.claim(access, body);
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

  /** Round 2 (E-07): mark a message urgent, normal or low. Whoever may reply for the account may. */
  @Put('priority')
  @RequirePermission('inbox.reply')
  setPriority(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(SetInboxPriorityRequest)) body: SetInboxPriorityRequest,
  ): Promise<InboxPriorityDto> {
    return this.inbox.setPriority(access, body);
  }

  /** H-14 and Round 2: the response targets of each company the caller may read the inbox of. */
  @Get('settings')
  @RequirePermission('inbox.read')
  listSettings(@CurrentAccess() access: Access): Promise<InboxClockSettingsDto[]> {
    return this.settings.list(access);
  }

  /**
   * Set a company's response targets (urgent, normal, low, and whether urgent counts round the clock). Needs
   * `inbox.manage` for the company; `approval_policy.manage`, the earlier gate, also still works.
   */
  @Put('settings')
  @RequirePermission('inbox.manage')
  setSettings(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(SetInboxClockSettingsRequest)) body: SetInboxClockSettingsRequest,
  ): Promise<InboxClockSettingsDto> {
    return this.settings.set(access, body);
  }
}

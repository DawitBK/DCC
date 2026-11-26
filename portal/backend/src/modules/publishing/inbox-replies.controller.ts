import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApproveReplyRequest,
  RejectReplyRequest,
  ReplyApprovalQuery,
  RequestReplyApprovalRequest,
  type ReplyApprovalDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { InboxRepliesService } from './inbox-replies.service';

/**
 * Round 2, E-08: sensitive replies wait for approval before they are sent. Asking needs `inbox.reply`; deciding needs
 * `content.approve` for the company (and never the writer). Every service method re-checks the permission for the company.
 */
@Controller('inbox/reply-approvals')
export class InboxRepliesController {
  constructor(private readonly replies: InboxRepliesService) {}

  /** Ask for approval of a sensitive reply. Nothing is sent. */
  @Post()
  @HttpCode(201)
  @RequirePermission('inbox.reply')
  request(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(RequestReplyApprovalRequest)) body: RequestReplyApprovalRequest,
  ): Promise<ReplyApprovalDto> {
    return this.replies.request(access, body);
  }

  /** Approvers see the requests of their companies; a writer sees their own. */
  @Get()
  @RequirePermission('inbox.read')
  list(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(ReplyApprovalQuery)) q: ReplyApprovalQuery,
  ): Promise<ReplyApprovalDto[]> {
    return this.replies.list(access, q);
  }

  /** The last needed approval sends the reply. */
  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('content.approve')
  approve(
    @CurrentAccess() access: Access,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ApproveReplyRequest)) body: ApproveReplyRequest,
  ): Promise<ReplyApprovalDto> {
    return this.replies.approve(access, id, body);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('content.approve')
  reject(
    @CurrentAccess() access: Access,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(RejectReplyRequest)) body: RejectReplyRequest,
  ): Promise<ReplyApprovalDto> {
    return this.replies.reject(access, id, body);
  }
}

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  APPROVAL_REQUEST_STATUSES,
  DecideApprovalRequest,
  ReviewContentRequest,
  type ApprovalQueueItemDto,
  type ApprovalRequestDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { ApprovalsService } from './approvals.service';

const QueueQuery = z.object({ status: z.enum(APPROVAL_REQUEST_STATUSES).default('pending') });

/** H-04 part 2: act on a specific approval request (created via POST /content-items/:id/submit). */
@Controller('approval-requests')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** The reviewers' queue. Oldest first; defaults to what still needs a decision. */
  @Get()
  @RequirePermission('content.review')
  list(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(QueueQuery)) q: z.infer<typeof QueueQuery>,
  ): Promise<ApprovalQueueItemDto[]> {
    return this.approvals.list(access, q.status);
  }

  @Post(':id/review')
  @HttpCode(201)
  @RequirePermission('content.review')
  review(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ReviewContentRequest)) body: ReviewContentRequest,
  ): Promise<ApprovalRequestDto> {
    return this.approvals.review(access, id, body);
  }

  @Post(':id/approve')
  @HttpCode(201)
  @RequirePermission('content.approve')
  approve(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(DecideApprovalRequest)) body: DecideApprovalRequest,
  ): Promise<ApprovalRequestDto> {
    return this.approvals.approve(access, id, body);
  }

  @Post(':id/reject')
  @HttpCode(201)
  @RequirePermission('content.approve')
  reject(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(DecideApprovalRequest)) body: DecideApprovalRequest,
  ): Promise<ApprovalRequestDto> {
    return this.approvals.reject(access, id, body);
  }
}

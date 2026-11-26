import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  APPROVAL_STATES,
  ConfirmEmergencyRequest,
  DecideApprovalRequest,
  EmergencyApproveRequest,
  ReviewContentRequest,
  type ApprovalQueueRowDto,
  type ApprovalRequestFullDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { ApprovalsService } from './approvals.service';

const QueueQuery = z.object({ status: z.enum(APPROVAL_STATES).default('pending') });

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
  ): Promise<ApprovalQueueRowDto[]> {
    return this.approvals.list(access, q.status);
  }

  @Post(':id/review')
  @HttpCode(201)
  @RequirePermission('content.review')
  review(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ReviewContentRequest)) body: ReviewContentRequest,
  ): Promise<ApprovalRequestFullDto> {
    return this.approvals.review(access, id, body);
  }

  @Post(':id/approve')
  @HttpCode(201)
  @RequirePermission('content.approve')
  approve(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(DecideApprovalRequest)) body: DecideApprovalRequest,
  ): Promise<ApprovalRequestFullDto> {
    return this.approvals.approve(access, id, body);
  }

  @Post(':id/reject')
  @HttpCode(201)
  @RequirePermission('content.approve')
  reject(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(DecideApprovalRequest)) body: DecideApprovalRequest,
  ): Promise<ApprovalRequestFullDto> {
    return this.approvals.reject(access, id, body);
  }

  /**
   * Round 2 (C1-14): settle a pending request as approved ALONE in an emergency, with a written reason. Only holders
   * of `content.emergency_approve`, never someone who wrote a version. A second approval is owed (confirm-emergency).
   */
  @Post(':id/emergency-approve')
  @HttpCode(201)
  @RequirePermission('content.emergency_approve')
  emergencyApprove(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(EmergencyApproveRequest)) body: EmergencyApproveRequest,
  ): Promise<ApprovalRequestFullDto> {
    return this.approvals.emergencyApprove(access, id, body);
  }

  /** Round 2 (C1-14): the second, different approver confirms an emergency approval. */
  @Post(':id/confirm-emergency')
  @HttpCode(201)
  @RequirePermission('content.approve')
  confirmEmergency(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmEmergencyRequest)) body: ConfirmEmergencyRequest,
  ): Promise<ApprovalRequestFullDto> {
    return this.approvals.confirmEmergency(access, id, body);
  }
}

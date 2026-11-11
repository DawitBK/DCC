import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  DecideApprovalRequest,
  ReviewContentRequest,
  type ApprovalRequestDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { ApprovalsService } from './approvals.service';

/** H-04 part 2: act on a specific approval request (created via POST /content-items/:id/submit). */
@Controller('approval-requests')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

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

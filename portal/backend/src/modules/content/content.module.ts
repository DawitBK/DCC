import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { ApprovalPolicyModule } from '../approval-policy/approval-policy.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApprovalClockService } from './approval-clock.service';
import { ContentApprovalVerifier } from './approval-verifier';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';

/** Drafts, versions, submit/review/approve/reject, and the ApprovalVerifier the publishing gate relies on. */
@Module({
  imports: [NotificationsModule, ApprovalPolicyModule],
  controllers: [ContentController, ApprovalsController, MediaController],
  providers: [
    ContentService,
    ApprovalsService,
    ApprovalClockService,
    ContentApprovalVerifier,
    MediaService,
  ],
  exports: [ContentApprovalVerifier, MediaService, ContentService],
})
export class ContentModule {}

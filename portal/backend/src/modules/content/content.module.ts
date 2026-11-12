import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContentApprovalVerifier } from './approval-verifier';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';

/** Drafts, versions, submit/review/approve/reject, and the ApprovalVerifier the publishing gate relies on. */
@Module({
  imports: [NotificationsModule],
  controllers: [ContentController, ApprovalsController],
  providers: [ContentService, ApprovalsService, ContentApprovalVerifier],
  exports: [ContentApprovalVerifier],
})
export class ContentModule {}

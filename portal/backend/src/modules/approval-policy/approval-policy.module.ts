import { Module } from '@nestjs/common';
import { ApprovalPolicyController } from './approval-policy.controller';
import { ApprovalPolicyService } from './approval-policy.service';

/** H-09: content categories and per-company approval policies. The content module asks it for the rule in force. */
@Module({
  controllers: [ApprovalPolicyController],
  providers: [ApprovalPolicyService],
  exports: [ApprovalPolicyService],
})
export class ApprovalPolicyModule {}

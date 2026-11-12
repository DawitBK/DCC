import { Module } from '@nestjs/common';
import { AccessGovernanceController } from './access-governance.controller';
import { AccessGovernanceService } from './access-governance.service';

/** People and roles administration (H-03): who may grant or revoke which role. */
@Module({
  controllers: [AccessGovernanceController],
  providers: [AccessGovernanceService],
})
export class AccessGovernanceModule {}

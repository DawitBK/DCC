import { Global, Module } from '@nestjs/common';
import { SweepService } from './sweep.service';
import { WorkingHoursController } from './working-hours.controller';
import { WorkingHoursService } from './working-hours.service';

/** Global on purpose: every Round 2 clock (inbox, approvals, incident review) uses the calendar and the sweep. */
@Global()
@Module({
  controllers: [WorkingHoursController],
  providers: [WorkingHoursService, SweepService],
  exports: [WorkingHoursService, SweepService],
})
export class WorkingHoursModule {}

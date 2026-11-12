import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Internal operations counts, registry gaps and the home-screen dashboard (not engagement analytics). */
@Module({
  controllers: [ReportsController, DashboardController],
  providers: [ReportsService, DashboardService],
})
export class ReportsModule {}

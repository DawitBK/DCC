import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IncidentDetailController } from './incident-detail.controller';
import { IncidentDetailService } from './incident-detail.service';
import { IncidentReviewController } from './incident-review.controller';
import { IncidentReviewService } from './incident-review.service';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

@Module({
  imports: [NotificationsModule, AlertsModule],
  controllers: [IncidentsController, IncidentDetailController, IncidentReviewController],
  providers: [IncidentsService, IncidentDetailService, IncidentReviewService],
})
export class IncidentsModule {}

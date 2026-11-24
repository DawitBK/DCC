import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { IncidentDetailController } from './incident-detail.controller';
import { IncidentDetailService } from './incident-detail.service';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

@Module({
  imports: [NotificationsModule],
  controllers: [IncidentsController, IncidentDetailController],
  providers: [IncidentsService, IncidentDetailService],
})
export class IncidentsModule {}

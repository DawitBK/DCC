import { Module } from '@nestjs/common';
import { ApprovalPolicyModule } from '../approval-policy/approval-policy.module';
import { ContentModule } from '../content/content.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EngineController } from './engine.controller';
import { EngineService } from './engine.service';
import { FreezeController } from './freeze.controller';
import { FreezeService } from './freeze.service';
import { InboxAckController } from './inbox-ack.controller';
import { InboxAckService } from './inbox-ack.service';
import { InboxModerationController } from './inbox-moderation.controller';
import { InboxModerationService } from './inbox-moderation.service';
import { InboxRepliesController } from './inbox-replies.controller';
import { InboxRepliesService } from './inbox-replies.service';
import { InboxClockService } from './inbox-clock.service';
import { InboxRespondersController } from './inbox-responders.controller';
import { InboxRespondersService } from './inbox-responders.service';
import { InboxRoutingService } from './inbox-routing.service';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { InboxSettingsService } from './inbox-settings.service';
import { DbIdempotencyStore } from './idempotency-store.service';
import {
  ANALYTICS_ENGINE,
  analyticsEngineProvider,
  operationalEngineProvider,
} from './operational-engine.provider';
import { PublicationRemovalService } from './publication-removal.service';
import { PublicationsController } from './publications.controller';
import { PublicationsService } from './publications.service';

/** Publishing records, the freeze switch, and the only path to the engine (GovernedEngine). */
@Module({
  imports: [ContentModule, NotificationsModule, ApprovalPolicyModule],
  controllers: [
    PublicationsController,
    FreezeController,
    EngineController,
    InboxController,
    InboxRespondersController,
    InboxRepliesController,
    InboxModerationController,
    InboxAckController,
  ],
  providers: [
    PublicationsService,
    PublicationRemovalService,
    FreezeService,
    EngineService,
    InboxService,
    InboxClockService,
    InboxRespondersService,
    InboxRoutingService,
    InboxSettingsService,
    InboxRepliesService,
    InboxModerationService,
    InboxAckService,
    DbIdempotencyStore,
    operationalEngineProvider,
    analyticsEngineProvider,
  ],
  exports: [ANALYTICS_ENGINE],
})
export class PublishingModule {}

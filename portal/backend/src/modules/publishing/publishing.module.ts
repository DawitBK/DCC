import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EngineController } from './engine.controller';
import { EngineService } from './engine.service';
import { FreezeController } from './freeze.controller';
import { FreezeService } from './freeze.service';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { DbIdempotencyStore } from './idempotency-store.service';
import { operationalEngineProvider } from './operational-engine.provider';
import { PublicationsController } from './publications.controller';
import { PublicationsService } from './publications.service';

/** Publishing records, the freeze switch, and the only path to the engine (GovernedEngine). */
@Module({
  imports: [ContentModule, NotificationsModule],
  controllers: [PublicationsController, FreezeController, EngineController, InboxController],
  providers: [
    PublicationsService,
    FreezeService,
    EngineService,
    InboxService,
    DbIdempotencyStore,
    operationalEngineProvider,
  ],
})
export class PublishingModule {}

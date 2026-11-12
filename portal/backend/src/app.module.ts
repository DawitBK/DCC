import { Module } from '@nestjs/common';
import { ContentApprovalVerifier } from './modules/content/approval-verifier';
import { ApprovalsController } from './modules/content/approvals.controller';
import { ApprovalsService } from './modules/content/approvals.service';
import { AuditController } from './modules/audit/audit.controller';
import { CompaniesController } from './modules/companies/companies.controller';
import { CompaniesService } from './modules/companies/companies.service';
import { ContentController } from './modules/content/content.controller';
import { ContentService } from './modules/content/content.service';
import { FreezeController } from './modules/publishing/freeze.controller';
import { FreezeService } from './modules/publishing/freeze.service';
import { DbIdempotencyStore } from './modules/publishing/idempotency-store.service';
import { operationalEngineProvider } from './modules/publishing/operational-engine.provider';
import { PublicationsController } from './modules/publishing/publications.controller';
import { PublicationsService } from './modules/publishing/publications.service';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { NotificationsService } from './modules/notifications/notifications.service';
import { ReportsController } from './modules/reports/reports.controller';
import { ReportsService } from './modules/reports/reports.service';
import { SocialAccountsController } from './modules/social-accounts/social-accounts.controller';
import { PlatformModule } from './platform/platform.module';

/**
 * Add a business module by creating its folder under src/modules/<name>/ and listing its controllers
 * and providers here (or, better, as its own @Module imported below). See docs/team/ADDING-A-MODULE.md.
 */
@Module({
  imports: [PlatformModule],
  controllers: [
    CompaniesController,
    SocialAccountsController,
    ContentController,
    ApprovalsController,
    PublicationsController,
    FreezeController,
    ReportsController,
    AuditController,
    NotificationsController,
  ],
  providers: [
    CompaniesService,
    ContentService,
    ApprovalsService,
    ContentApprovalVerifier,
    DbIdempotencyStore,
    FreezeService,
    operationalEngineProvider,
    PublicationsService,
    ReportsService,
    NotificationsService,
  ],
})
export class AppModule {}

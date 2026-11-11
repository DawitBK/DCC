import { Module } from '@nestjs/common';
import { ContentApprovalVerifier } from './modules/content/approval-verifier';
import { ApprovalsController } from './modules/content/approvals.controller';
import { ApprovalsService } from './modules/content/approvals.service';
import { AuditController } from './modules/audit/audit.controller';
import { CompaniesController } from './modules/companies/companies.controller';
import { CompaniesService } from './modules/companies/companies.service';
import { ContentController } from './modules/content/content.controller';
import { ContentService } from './modules/content/content.service';
import { SocialAccountsController } from './modules/social-accounts/social-accounts.controller';
import { PlatformModule } from './platform/platform.module';

/**
 * Add a business module by creating its folder under src/modules/<name>/ and listing its controllers
 * and providers here (or, better, as its own @Module imported below). See docs/team/ADDING-A-MODULE.md.
 *
 * ApprovalVerifier has no controller of its own: it is the interface GovernedEngine calls before
 * publishing (H-05, not yet built - this registers it in the DI graph so that wiring is a one-line
 * change when it lands).
 */
@Module({
  imports: [PlatformModule],
  controllers: [
    CompaniesController,
    SocialAccountsController,
    ContentController,
    ApprovalsController,
    AuditController,
  ],
  providers: [CompaniesService, ContentService, ApprovalsService, ContentApprovalVerifier],
})
export class AppModule {}

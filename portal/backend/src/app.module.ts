import { Module } from '@nestjs/common';
import { AccessGovernanceController } from './modules/access-governance/access-governance.controller';
import { AccessGovernanceService } from './modules/access-governance/access-governance.service';
import { AuditController } from './modules/audit/audit.controller';
import { CompaniesController } from './modules/companies/companies.controller';
import { CompaniesService } from './modules/companies/companies.service';
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
    AccessGovernanceController,
    AuditController,
  ],
  providers: [CompaniesService, AccessGovernanceService],
})
export class AppModule {}

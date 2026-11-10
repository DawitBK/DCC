import { Module } from '@nestjs/common';
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
  controllers: [CompaniesController, SocialAccountsController, AuditController],
  providers: [CompaniesService],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { AccessGovernanceModule } from './modules/access-governance/access-governance.module';
import { ApprovalPolicyModule } from './modules/approval-policy/approval-policy.module';
import { AuditModule } from './modules/audit/audit.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { ContentModule } from './modules/content/content.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PublishingModule } from './modules/publishing/publishing.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SocialAccountsModule } from './modules/social-accounts/social-accounts.module';
import { PlatformModule } from './platform/platform.module';

/**
 * One Nest module per feature under src/modules/<name>/ (controller = routes, service = logic and
 * queries, module = wiring). Add a feature by creating its folder and listing its module here.
 * Cross-feature use goes through exports (e.g. NotificationsModule, ContentModule's verifier), never
 * by reaching into another feature's files. See docs/team/ADDING-A-MODULE.md.
 */
@Module({
  imports: [
    PlatformModule,
    CompaniesModule,
    SocialAccountsModule,
    AccessGovernanceModule,
    ApprovalPolicyModule,
    ContentModule,
    PublishingModule,
    IncidentsModule,
    ReportsModule,
    AuditModule,
    NotificationsModule,
  ],
})
export class AppModule {}

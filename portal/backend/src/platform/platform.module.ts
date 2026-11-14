import { Global, Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, loadConfig } from '../config/env';
import { AuditService } from './audit/audit.service';
import { AccessService } from './auth/access.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { OidcService } from './auth/oidc.service';
import { SessionGuard } from './auth/session.guard';
import { SessionService } from './auth/session.service';
import { KeyFileSecretsProvider, LocalDevSecretsProvider, SECRETS } from './crypto/secrets';
import { createDatabase, DATABASE, type Database } from './database/database';
import { HealthController } from './observability/health.controller';
import { MetricsService } from './observability/metrics.service';
import { TenantDb } from './tenancy/tenant-db';
import type { AppConfig } from '../config/env';

/**
 * Platform foundation (owner: Dawit): configuration, database, tenancy, identity, sessions,
 * authorization guard, audit, secrets, health and metrics. Business modules import nothing from here
 * explicitly: everything is global, so a feature module only declares its own controllers/services.
 */
@Global()
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])],
  controllers: [AuthController, HealthController],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => createDatabase(cfg.DCC_DATABASE_URL, cfg.DCC_DB_POOL_MAX),
    },
    {
      provide: SECRETS,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) =>
        cfg.SECRETS_PROVIDER === 'key-file'
          ? new KeyFileSecretsProvider(cfg.DCC_KEY_FILE!)
          : new LocalDevSecretsProvider(cfg.DCC_LOCAL_ENCRYPTION_KEY!),
    },
    TenantDb,
    AuditService,
    SessionService,
    AccessService,
    OidcService,
    AuthService,
    MetricsService,
    // Order matters: rate limiting first, then authentication/authorization (deny by default).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [
    APP_CONFIG,
    DATABASE,
    SECRETS,
    TenantDb,
    AuditService,
    SessionService,
    AccessService,
    MetricsService,
  ],
})
export class PlatformModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: Database) {}
  async onApplicationShutdown() {
    await this.database.close();
  }
}

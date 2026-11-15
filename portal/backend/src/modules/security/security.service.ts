import { Inject, Injectable } from '@nestjs/common';
import type { SecurityPostureDto } from '@dcc/contracts';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { AuditService } from '../../platform/audit/audit.service';
import type { Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';

const ADMIN_ROLES = ['group_admin', 'company_admin', 'security_admin', 'group_cto'];
const NEW_ADMIN_DAYS = 30;

/**
 * H-10: the security overview. It reports ONLY what DCC really knows, and lists by name what it does
 * not monitor, so nobody reads an empty panel as "all is well" (proposal: never present unavailable
 * information as if it were monitored).
 */
@Injectable()
export class SecurityService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async posture(access: Access): Promise<SecurityPostureDto> {
    const since = new Date(Date.now() - NEW_ADMIN_DAYS * 24 * 60 * 60 * 1000);
    const chain = await this.audit.verifyChain();
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'security.read');
      const scope = companyIds.length ? companyIds : [NIL];

      const grants = await trx
        .selectFrom('audit_events')
        .select(['occurred_at', 'company_id', 'details'])
        .where('action', '=', 'access.membership_granted')
        .where('occurred_at', '>=', since)
        .orderBy('occurred_at', 'desc')
        .limit(500)
        .execute();
      const newAdministrators = grants
        .map((g) => ({ g, d: g.details as { userId?: string; role?: string } }))
        .filter(({ d }) => d.role !== undefined && ADMIN_ROLES.includes(d.role))
        .map(({ g, d }) => ({
          userId: d.userId ?? null,
          role: d.role!,
          companyId: g.company_id,
          grantedAt: g.occurred_at.toISOString(),
        }));

      const accounts = await trx
        .selectFrom('social_accounts')
        .select(['status', 'owner_user_id', 'backup_admin_user_id', 'engine_channel_id'])
        .where('company_id', 'in', scope)
        .execute();
      const live = accounts.filter((a) => a.status !== 'archived');

      const freezes = await trx
        .selectFrom('publishing_freezes')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('company_id', 'in', scope)
        .executeTakeFirstOrThrow();

      const incidents = await trx
        .selectFrom('incidents')
        .select(['severity', (eb) => eb.fn.countAll().as('n')])
        .where('company_id', 'in', scope)
        .where('status', 'in', ['open', 'investigating'])
        .groupBy('severity')
        .execute();
      const openIncidents = { low: 0, medium: 0, high: 0, critical: 0 };
      for (const i of incidents)
        openIncidents[i.severity as keyof typeof openIncidents] = Number(i.n);

      return {
        generatedAt: new Date().toISOString(),
        twoFactorSignIn: {
          enforced: this.cfg.requireMfa,
          note: 'Every DCC sign-in needs a password and an authenticator code: enforced by the SSO and again by DCC. It is true for everyone by construction, not counted.',
        },
        sensitiveActions: { signInAgainAfterMinutes: this.cfg.DCC_REAUTH_MAX_AGE_MINUTES },
        auditTrail: {
          chainOk: chain.ok,
          events: chain.checked,
          firstBrokenId: chain.firstBrokenId,
        },
        newAdministrators: { days: NEW_ADMIN_DAYS, items: newAdministrators },
        accounts: {
          total: live.length,
          withoutOwner: live.filter((a) => !a.owner_user_id).length,
          withoutBackupAdmin: live.filter((a) => !a.backup_admin_user_id).length,
          notConnectedToEngine: live.filter((a) => !a.engine_channel_id).length,
          needsAttention: live.filter((a) => a.status === 'needs_attention').length,
          disconnected: live.filter((a) => a.status === 'disconnected').length,
        },
        publishingFreezes: Number(freezes.n),
        openIncidents,
        notMonitored: [
          'Token expiry of the connected accounts (needs the operational engine, W-03)',
          'Connection health reported by the networks (needs the operational engine, W-03)',
          'Two-factor sign-in on the networks themselves (checked by hand in the onboarding checklist)',
          'Posts made directly on a network, outside DCC (needs reconciliation, W-05)',
        ],
      };
    });
  }
}

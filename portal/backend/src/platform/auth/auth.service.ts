import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { AuditActions, AuditService } from '../audit/audit.service';
import { DATABASE, type Database } from '../database/database';
import { LoginError, type LoginResult } from './oidc.service';
import { SessionService } from './session.service';

/** What happens after the IdP has proven who the person is: provision, bootstrap, session, audit. */
@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(DATABASE) private readonly database: Database,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async finishLogin(result: LoginResult, meta: { ip?: string; userAgent?: string }) {
    const { rows } = await sql<{ id: string; status: string }>`
      select * from auth_upsert_user(${result.subject}, ${result.email}, ${result.name})`.execute(
      this.database.db,
    );
    const user = rows[0]!;
    if (user.status !== 'active')
      throw new LoginError('This account is disabled in DCC.', 'user_disabled');

    await this.syncBootstrapAdmin(user.id, result);

    const session = await this.sessions.create({
      userId: user.id,
      idToken: result.idToken,
      idpSid: result.sid,
      // Null when the IdP did not say: "not known" is never treated as "just now".
      authenticatedAt: result.authTime ?? null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.audit.recordStandalone({
      action: AuditActions.authLogin,
      actorUserId: user.id,
      actorSubject: result.subject,
      ip: meta.ip,
      details: result.reauth ? { reauthentication: true } : {},
    });
    return { userId: user.id, session };
  }

  /**
   * Group administrators are bootstrapped from the IdP's application-role claim (`dcc-group-admin`),
   * so no person is hard-coded in DCC. Claim present and listing the role => grant; present and not
   * listing it => revoke ONLY the grant that came from the IdP; claim absent => unknown, change nothing.
   */
  private async syncBootstrapAdmin(userId: string, result: LoginResult): Promise<void> {
    let isAdmin: boolean | undefined;
    if (result.appRoles !== undefined)
      isAdmin = result.appRoles.includes(this.cfg.OIDC_GROUP_ADMIN_ROLE);
    if (
      this.cfg.environment === 'development' &&
      this.cfg.DCC_DEV_BOOTSTRAP_ADMIN_EMAILS.includes(result.email)
    )
      isAdmin = true;
    if (isAdmin === undefined) return;

    const { rows } = await sql<{ outcome: string }>`
      select auth_sync_idp_group_admin(${userId}::uuid, ${this.cfg.DCC_DEFAULT_GROUP_SLUG}, ${isAdmin}) as outcome`.execute(
      this.database.db,
    );
    const outcome = rows[0]?.outcome;
    if (outcome === 'granted' || outcome === 'revoked') {
      await this.audit.recordStandalone({
        action:
          outcome === 'granted'
            ? AuditActions.adminBootstrapGranted
            : AuditActions.adminBootstrapRevoked,
        actorUserId: userId,
        actorSubject: result.subject,
        targetType: 'user',
        targetId: userId,
        details: { role: 'group_admin', source: 'idp' },
      });
    }
  }
}

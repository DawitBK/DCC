import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { MeResponse } from '@dcc/contracts';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { AuditActions, AuditService } from '../audit/audit.service';
import { permissionsOf, type Access } from '../authz/authz';
import { Public } from '../authz/decorators';
import { CurrentAccess } from '../http/http-support';
import { AuthService } from './auth.service';
import { OidcService } from './oidc.service';
import { SessionService } from './session.service';
import { sessionCookieName } from './session.guard';

@Controller()
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly oidc: OidcService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Starts the sign-in with the existing Kerchanshe IdP. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('auth/login')
  async login(
    @Query('returnTo') returnTo: string | undefined,
    @Query('reauth') reauth: string | undefined,
    @Res() res: Response,
  ) {
    // ?reauth=1: the person is asked to prove who they are again, for a sensitive action (L-07).
    res.redirect(302, await this.oidc.beginLogin(returnTo, { reauth: reauth === '1' }));
  }

  /** The IdP sends the browser back here with ?code&state. Any failure ends at one generic page: no detail is echoed. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('auth/callback')
  async callback(@Req() req: Request, @Res() res: Response) {
    const web = new URL(this.cfg.DCC_WEB_ORIGIN).origin;
    try {
      const query = new URL(req.originalUrl, web).searchParams;
      const result = await this.oidc.completeLogin(query);
      const { session } = await this.auth.finishLogin(result, {
        ip: req.ip,
        userAgent: req.header('user-agent'),
      });
      // A re-authentication (or a second sign-in) replaces the session the browser already had: end the old one.
      const previous = (req.cookies as Record<string, string> | undefined)?.[
        sessionCookieName(this.cfg)
      ];
      if (previous && previous !== session.id)
        await this.sessions.destroy(previous).catch(() => undefined);
      res.cookie(sessionCookieName(this.cfg), session.id, {
        httpOnly: true,
        secure: this.cfg.isProduction,
        sameSite: 'lax',
        path: '/',
        expires: session.expiresAt,
      });
      res.redirect(302, `${web}${this.cfg.DCC_WEB_BASE_PATH}${result.returnTo}`);
    } catch (error) {
      const reason = (error as { reason?: string }).reason ?? (error as Error).name;
      await this.audit
        .recordStandalone({ action: AuditActions.authLoginFailed, ip: req.ip, details: { reason } })
        .catch(() => undefined);
      res.redirect(302, `${web}${this.cfg.DCC_WEB_BASE_PATH}/?error=signin_failed`);
    }
  }

  /** Ends the DCC session and tells the browser where to go to end the shared SSO session as well. */
  @Post('auth/logout')
  @HttpCode(200)
  async logout(
    @CurrentAccess() access: Access,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionId = req.sessionId!;
    const hint = await this.sessions.idTokenHint(sessionId).catch(() => null);
    await this.sessions.destroy(sessionId);
    res.clearCookie(sessionCookieName(this.cfg), {
      httpOnly: true,
      secure: this.cfg.isProduction,
      sameSite: 'lax',
      path: '/',
    });
    await this.audit.recordStandalone({
      action: AuditActions.authLogout,
      actorUserId: access.userId,
      ip: req.ip,
    });
    const logoutUrl = await this.oidc.endSessionUrl(hint).catch(() => null);
    return { logoutUrl };
  }

  /**
   * OIDC back-channel logout: the IdP posts a signed logout_token when someone signs out of SSO or is
   * disabled. We verify it and end their DCC sessions. Always answers 200 so it cannot be used to probe users.
   */
  @Public()
  @Post('auth/backchannel-logout')
  @HttpCode(200)
  async backchannelLogout(@Body() body: { logout_token?: string }) {
    try {
      if (typeof body?.logout_token === 'string') {
        const { sub, sid } = await this.oidc.verifyLogoutToken(body.logout_token);
        const ended =
          (sub ? await this.sessions.destroyAllForSubject(sub) : 0) +
          (sid ? await this.sessions.destroyByIdpSid(sid) : 0);
        await this.audit.recordStandalone({
          action: AuditActions.authBackchannelLogout,
          actorSubject: sub ?? null,
          details: { sessionsEnded: ended },
        });
      }
    } catch {
      /* invalid token: ignored on purpose */
    }
    return {};
  }

  @Get('me')
  me(@CurrentAccess() access: Access): MeResponse {
    return {
      user: { id: access.userId, email: access.email, displayName: access.displayName },
      memberships: access.memberships,
      permissions: permissionsOf(access),
    };
  }
}

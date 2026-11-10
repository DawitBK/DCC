import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Permission } from '@dcc/contracts';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { AuditActions, AuditService } from '../audit/audit.service';
import { canAnywhere, type Access } from '../authz/authz';
import { IS_PUBLIC, REQUIRED_PERMISSION } from '../authz/decorators';
import { AccessService, UserDisabledError } from './access.service';
import { SessionService } from './session.service';

export const sessionCookieName = (cfg: Pick<AppConfig, 'isProduction'>) =>
  cfg.isProduction ? '__Host-dcc_sid' : 'dcc_sid';

declare module 'express-serve-static-core' {
  interface Request {
    access?: Access;
    sessionId?: string;
  }
}

/**
 * Global guard, deny by default. Every route needs a valid session unless marked @Public(). On each
 * request it re-reads the caller's memberships from the database (`req.access`), then applies the
 * coarse @RequirePermission gate. Services still check the permission for the specific record.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly accessService: AccessService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const rawId = (req.cookies as Record<string, string> | undefined)?.[
      sessionCookieName(this.cfg)
    ];
    if (!rawId) throw new UnauthorizedException('Sign in required.');

    const session = await this.sessions.find(rawId);
    if (!session) throw new UnauthorizedException('Your session has ended. Sign in again.');

    let access: Access | null;
    try {
      access = await this.accessService.resolve(session.userId);
    } catch (error) {
      if (error instanceof UserDisabledError) {
        await this.sessions.destroy(rawId);
        throw new UnauthorizedException('This account is disabled.');
      }
      throw error;
    }
    if (!access) throw new UnauthorizedException('Unknown user.');
    req.access = access;
    req.sessionId = rawId;

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      targets,
    );
    if (required && !canAnywhere(access, required)) {
      await this.audit
        .recordStandalone({
          action: AuditActions.accessDenied,
          actorUserId: access.userId,
          details: { permission: required, method: req.method, path: req.path },
        })
        .catch(() => undefined);
      throw new ForbiddenException('You do not have permission to do that.');
    }
    return true;
  }
}

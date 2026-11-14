import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@dcc/contracts';

export const IS_PUBLIC = 'dcc:isPublic';
export const REQUIRED_PERMISSION = 'dcc:requiredPermission';

/** Opts a route out of authentication. Use sparingly: health checks, the OIDC entry points, the IdP's logout callback. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Coarse gate: the caller must hold this permission somewhere. The service STILL checks the permission
 * for the specific company/record (authz.can) before it acts: this decorator alone is not enough.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

export const REQUIRES_RECENT_AUTH = 'dcc:requiresRecentAuth';

/**
 * For sensitive actions (granting or removing a role, lifting a publishing freeze, exporting the audit
 * trail): the caller must have proved who they are at the SSO within the last
 * `DCC_REAUTH_MAX_AGE_MINUTES`. Otherwise the route answers 401 with `code: "reauth_required"`, and the
 * web app sends the person to `/api/auth/login?reauth=1&returnTo=<where they were>`.
 * Use it IN ADDITION to @RequirePermission, never instead of it.
 */
export const RequireRecentAuth = () => SetMetadata(REQUIRES_RECENT_AUTH, true);

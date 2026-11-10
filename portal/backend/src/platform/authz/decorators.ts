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

import { z } from 'zod';

export const APP_CONFIG = Symbol('APP_CONFIG');

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const PLACEHOLDER = /(change-?me|replace-with|example\.com|dev-only|^password$|^12345678$)/i;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Which kind of installation this is. Unset = derived from NODE_ENV (production -> production, else development).
   * 'mirror' is the local rehearsal of production: production-style checks (placeholders, no dev admins, MFA on)
   * but plain http on this PC's loopback and the dev key provider are allowed. Real production is never 'mirror'.
   */
  DCC_ENVIRONMENT: z.enum(['development', 'mirror', 'production']).optional(),
  /** Path DCC is served under behind the reverse proxy, e.g. /dcc (like /dms and /gms). Empty = the site root. */
  DCC_WEB_BASE_PATH: z
    .string()
    .regex(/^(\/[a-z0-9-]+)?$/, 'must be empty or look like /dcc')
    .default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Ports: DCC's slot in the platform port registry (kup/docs/standards/PORTS.md): API 7716, web 7717.
  DCC_API_PORT: z.coerce.number().int().min(1).max(65535).default(7716),
  /** Where the browser reaches DCC. The API accepts state-changing requests only from this origin. */
  DCC_WEB_ORIGIN: z.url().default('http://localhost:7717'),

  /** Reverse proxies between the browser and the API (dev: the Next.js rewrite = 1; production adds Apache = 2). */
  DCC_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

  /** The runtime database role (dcc_app). Never the owner, never a superuser. */
  DCC_DATABASE_URL: z.string().min(1),
  DCC_DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  // Existing Kerchanshe IdP / SSO (OIDC). Values come from the SSO registration of the "dcc" client.
  OIDC_ISSUER: z.url().default('http://localhost:7301'),
  /** Optional server-to-server base URL for the IdP when it differs from the browser-facing issuer. */
  OIDC_INTERNAL_URL: z.url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).default('dcc'),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI: z.url().default('http://localhost:7717/api/auth/callback'),
  OIDC_POST_LOGOUT_URI: z.url().default('http://localhost:7717/'),
  OIDC_SCOPES: z.string().default('openid profile email app_roles'),
  OIDC_APP_ROLES_CLAIM: z.string().default('https://idp.kerchanshe.com/app_roles'),
  /** The IdP application role that bootstraps a DCC group administrator. */
  OIDC_GROUP_ADMIN_ROLE: z.string().default('dcc-group-admin'),

  /**
   * Refuse a sign-in whose id_token does not show a second factor (`amr` contains `mfa`). Decision D-07:
   * enforced. Defaults to ON in production and OFF elsewhere (the dev SSO may not enrol every test user);
   * set it explicitly to override either way. The SSO enforces it too (platform setting `mfa.requiredApps`);
   * this is the second lock so DCC never relies on a setting someone else can change.
   */
  DCC_REQUIRE_MFA: z.enum(['true', 'false']).optional(),

  SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(480),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(480).default(30),

  /** 'local-dev' is refused in production. Production needs a real key service (ADR-0007). */
  SECRETS_PROVIDER: z.enum(['local-dev']).default('local-dev'),
  DCC_LOCAL_ENCRYPTION_KEY: z.string().optional(),

  DCC_DEFAULT_GROUP_SLUG: z.string().min(2).default('kerchanshe'),
  /** DEVELOPMENT ONLY: emails granted group_admin at login without an IdP role. Must be empty in production. */
  DCC_DEV_BOOTSTRAP_ADMIN_EMAILS: csv,

  ENGINE_PROVIDER: z.enum(['fake', 'postiz']).default('fake'),
  POSTIZ_BASE_URL: z.url().optional(),
  POSTIZ_API_KEY: z.string().optional(),

  /** If set, GET /api/metrics requires this bearer token. Unset = metrics are off. */
  METRICS_TOKEN: z.string().optional(),
  /** Swagger UI is off in production unless explicitly enabled. */
  DCC_ENABLE_API_DOCS: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof schema> & {
  /** development | mirror | production (see DCC_ENVIRONMENT). */
  environment: 'development' | 'mirror' | 'production';
  /** True only for real production: Secure cookies, https only, no dev shortcuts. */
  isProduction: boolean;
  requireMfa: boolean;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  // `.env.example` ships optional settings as `NAME=`: an empty value means "not set", not "invalid".
  const present = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  );
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid DCC configuration:\n${lines.join('\n')}`);
  }
  const cfg = parsed.data;
  const problems: string[] = [];
  const environment =
    cfg.DCC_ENVIRONMENT ?? (cfg.NODE_ENV === 'production' ? 'production' : 'development');
  const isProduction = environment === 'production';

  if (environment !== 'development') {
    if (cfg.OIDC_CLIENT_SECRET.length < 16 || PLACEHOLDER.test(cfg.OIDC_CLIENT_SECRET)) {
      problems.push('OIDC_CLIENT_SECRET is missing, too short or still a placeholder');
    }
    if (PLACEHOLDER.test(cfg.DCC_DATABASE_URL))
      problems.push('DCC_DATABASE_URL still contains a placeholder password');
    if (cfg.DCC_DEV_BOOTSTRAP_ADMIN_EMAILS.length > 0) {
      problems.push(
        'DCC_DEV_BOOTSTRAP_ADMIN_EMAILS must be empty outside development (grant admins through the IdP role)',
      );
    }
  }
  if (isProduction) {
    const isLocal = (u: string) => /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u);
    for (const [name, value] of [
      ['DCC_WEB_ORIGIN', cfg.DCC_WEB_ORIGIN],
      ['OIDC_ISSUER', cfg.OIDC_ISSUER],
      ['OIDC_REDIRECT_URI', cfg.OIDC_REDIRECT_URI],
      ['OIDC_POST_LOGOUT_URI', cfg.OIDC_POST_LOGOUT_URI],
    ] as const) {
      if (!value.startsWith('https://')) problems.push(`${name} must be https in production`);
      if (isLocal(value)) problems.push(`${name} must not point at localhost in production`);
    }
    if (cfg.SECRETS_PROVIDER === 'local-dev') {
      problems.push(
        'SECRETS_PROVIDER=local-dev is not allowed in production (it keeps the key in an environment variable)',
      );
    }
  }
  if (cfg.ENGINE_PROVIDER === 'postiz' && (!cfg.POSTIZ_BASE_URL || !cfg.POSTIZ_API_KEY)) {
    problems.push('ENGINE_PROVIDER=postiz needs POSTIZ_BASE_URL and POSTIZ_API_KEY');
  }
  if (cfg.SECRETS_PROVIDER === 'local-dev' && !isProduction && !cfg.DCC_LOCAL_ENCRYPTION_KEY) {
    problems.push(
      "DCC_LOCAL_ENCRYPTION_KEY is required (base64, 32 bytes). Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to start:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  if (isProduction && cfg.DCC_REQUIRE_MFA === 'false') {
    throw new Error(
      'Refusing to start:\n  - DCC_REQUIRE_MFA=false is not allowed in production (D-07)',
    );
  }
  return {
    ...cfg,
    environment,
    isProduction,
    requireMfa: cfg.DCC_REQUIRE_MFA
      ? cfg.DCC_REQUIRE_MFA === 'true'
      : environment !== 'development',
  };
}

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env';
import { LocalDevSecretsProvider } from './crypto/secrets';
import { JsonLogger, redact } from './observability/logger';
import { hasMfa, safeReturnTo, toInternalUrl } from './auth/oidc.service';

const base = {
  DCC_DATABASE_URL: 'postgres://dcc_app:x@127.0.0.1:5436/dcc_dev',
  OIDC_CLIENT_SECRET: 'a-long-enough-client-secret-123',
  DCC_LOCAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('configuration', () => {
  it('loads a valid development configuration with defaults for the registered ports', () => {
    const cfg = loadConfig({ ...base });
    expect(cfg.DCC_API_PORT).toBe(7716);
    expect(cfg.isProduction).toBe(false);
  });

  it('treats empty optional values (as shipped in .env.example) as unset', () => {
    const cfg = loadConfig({
      ...base,
      POSTIZ_BASE_URL: '',
      POSTIZ_API_KEY: '',
      DCC_ENABLE_API_DOCS: '',
      METRICS_TOKEN: '',
    });
    expect(cfg.POSTIZ_BASE_URL).toBeUndefined();
    expect(cfg.DCC_ENABLE_API_DOCS).toBe(false);
  });

  it('explains what is missing', () => {
    expect(() => loadConfig({})).toThrow(/DCC_DATABASE_URL/);
  });

  it('refuses production with development shortcuts', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      /https|localhost|local-dev/,
    );
  });

  it('refuses a production configuration that still has localhost, a placeholder secret or a dev admin list', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      DCC_WEB_ORIGIN: 'https://dcc.example.org',
      OIDC_ISSUER: 'https://sso.example.org',
      OIDC_REDIRECT_URI: 'https://dcc.example.org/api/auth/callback',
      OIDC_POST_LOGOUT_URI: 'https://dcc.example.org/',
    };
    const problems = (() => {
      try {
        loadConfig({
          ...prod,
          OIDC_CLIENT_SECRET: 'change-me-change-me-change-me',
          DCC_DEV_BOOTSTRAP_ADMIN_EMAILS: 'a@b.c',
        });
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(problems).toMatch(/placeholder/);
    expect(problems).toMatch(/DCC_DEV_BOOTSTRAP_ADMIN_EMAILS/);
    expect(problems).toMatch(/SECRETS_PROVIDER=local-dev/);
  });

  it('development works with no key set (practice key); the mirror still requires one', () => {
    const { DCC_LOCAL_ENCRYPTION_KEY: _unused, ...noKey } = base;
    expect(Buffer.from(loadConfig(noKey).DCC_LOCAL_ENCRYPTION_KEY!, 'base64')).toHaveLength(32);
    expect(() => loadConfig({ ...noKey, DCC_ENVIRONMENT: 'mirror' })).toThrow(
      /DCC_LOCAL_ENCRYPTION_KEY/,
    );
  });

  it('requires the Postiz settings when the Postiz engine is selected', () => {
    expect(() => loadConfig({ ...base, ENGINE_PROVIDER: 'postiz' })).toThrow(/POSTIZ_BASE_URL/);
  });

  it('MFA (D-07): off by default in development, overridable, and cannot be turned off in production', () => {
    expect(loadConfig({ ...base }).requireMfa).toBe(false);
    expect(loadConfig({ ...base, DCC_REQUIRE_MFA: 'true' }).requireMfa).toBe(true);
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        DCC_REQUIRE_MFA: 'false',
        DCC_WEB_ORIGIN: 'https://dcc.example.org',
        OIDC_ISSUER: 'https://sso.example.org',
        OIDC_REDIRECT_URI: 'https://dcc.example.org/api/auth/callback',
        OIDC_POST_LOGOUT_URI: 'https://dcc.example.org/',
        SECRETS_PROVIDER: 'local-dev',
      }),
    ).toThrow(/DCC_REQUIRE_MFA=false is not allowed in production|local-dev/);
  });
});

describe('MFA claim (amr)', () => {
  it.each([
    [['pwd', 'otp', 'mfa'], true],
    [['pwd'], false],
    [undefined, false],
    ['mfa', false],
    [[], false],
  ])('%j -> %s', (amr, expected) => expect(hasMfa(amr)).toBe(expected));
});

describe('local development secrets provider', () => {
  const secrets = new LocalDevSecretsProvider(base.DCC_LOCAL_ENCRYPTION_KEY);

  it('round-trips and is not marked production grade', async () => {
    const sealed = await secrets.encrypt('top secret', 'ctx');
    expect(sealed).not.toContain('top secret');
    expect(await secrets.decrypt(sealed, 'ctx')).toBe('top secret');
    expect(secrets.productionGrade).toBe(false);
  });

  it('a ciphertext made for one purpose does not decrypt for another', async () => {
    const sealed = await secrets.encrypt('x', 'session.id_token');
    await expect(secrets.decrypt(sealed, 'something.else')).rejects.toThrow();
  });

  it('detects tampering', async () => {
    const sealed = await secrets.encrypt('x', 'c');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    await expect(secrets.decrypt(parts.join('.'), 'c')).rejects.toThrow();
  });

  it('rejects a key of the wrong size', () => {
    expect(() => new LocalDevSecretsProvider(Buffer.alloc(8).toString('base64'))).toThrow(
      /32 bytes/,
    );
  });
});

describe('log redaction', () => {
  it('never keeps tokens, secrets, cookies or passwords, at any depth', () => {
    const out = redact({
      user: 'u',
      headers: { authorization: 'Bearer abc', cookie: 'sid=1' },
      nested: [{ client_secret: 's', ok: 1 }],
      id_token: 'jwt',
    });
    expect(JSON.stringify(out)).not.toMatch(/Bearer abc|sid=1|"s"|jwt/);
    expect(out).toMatchObject({ user: 'u', nested: [{ ok: 1 }] });
  });

  it('an error is written with its text, never as an empty object', () => {
    expect(redact(new Error('Key file not found: X'))).toEqual({
      name: 'Error',
      message: 'Key file not found: X',
    });
    expect(redact({ cause: new TypeError('bad') })).toEqual({
      cause: { name: 'TypeError', message: 'bad' },
    });

    // What the framework does when the application cannot start: it logs the Error itself.
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      new JsonLogger('info').error(
        new Error('Key file C:/x/dcc.keys.json: key "k1" must be 32 bytes'),
      );
    } finally {
      process.stderr.write = original;
    }
    const line = JSON.parse(written[0]!);
    expect(line.message).toBe('Key file C:/x/dcc.keys.json: key "k1" must be 32 bytes');
    expect(line.errorName).toBe('Error');
    expect(line.stack).toContain('platform.test');
  });
});

describe('returnTo (open redirect defence)', () => {
  it.each([
    ['/companies', '/companies'],
    ['//evil.example', '/'],
    ['https://evil.example', '/'],
    ['/\\evil.example', '/'],
    [undefined, '/'],
    [42, '/'],
  ])('%s -> %s', (input, expected) => expect(safeReturnTo(input)).toBe(expected));
});

describe('environments: development, mirror, production', () => {
  const mirror = {
    ...base,
    NODE_ENV: 'production',
    DCC_ENVIRONMENT: 'mirror',
    DCC_WEB_ORIGIN: 'http://localhost:8090',
    DCC_WEB_BASE_PATH: '/dcc',
  };

  it('the mirror may use loopback http and the dev key provider, with MFA on by default', () => {
    const cfg = loadConfig(mirror);
    expect(cfg.environment).toBe('mirror');
    expect(cfg.isProduction).toBe(false);
    expect(cfg.requireMfa).toBe(true);
    expect(cfg.DCC_WEB_BASE_PATH).toBe('/dcc');
  });

  it('the mirror still refuses placeholder secrets and a dev admin list', () => {
    expect(() =>
      loadConfig({ ...mirror, OIDC_CLIENT_SECRET: 'change-me-change-me-change-me' }),
    ).toThrow(/placeholder/);
    expect(() => loadConfig({ ...mirror, DCC_DEV_BOOTSTRAP_ADMIN_EMAILS: 'a@b.c' })).toThrow(
      /DCC_DEV_BOOTSTRAP_ADMIN_EMAILS/,
    );
  });

  it('a bad base path is rejected', () => {
    expect(() => loadConfig({ ...base, DCC_WEB_BASE_PATH: 'dcc/' })).toThrow(/DCC_WEB_BASE_PATH/);
  });

  it('NODE_ENV=production with no DCC_ENVIRONMENT is real production (strict)', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/https|localhost/);
  });
});

describe('IdP internal address mapping', () => {
  it('dev: same paths on a different port', () => {
    expect(
      toInternalUrl(
        'http://localhost:7301/.well-known/x',
        'http://localhost:7301',
        'http://127.0.0.1:7300',
      ),
    ).toBe('http://127.0.0.1:7300/.well-known/x');
  });
  it('mirror: the issuer path (/sso) is dropped for both public and internal addresses', () => {
    const args = ['http://localhost:8090/sso', 'http://127.0.0.1:9300'] as const;
    expect(
      toInternalUrl('http://localhost:8090/sso/.well-known/openid-configuration', ...args),
    ).toBe('http://127.0.0.1:9300/.well-known/openid-configuration');
    expect(toInternalUrl('http://127.0.0.1:9300/sso/token?a=1', ...args)).toBe(
      'http://127.0.0.1:9300/token?a=1',
    );
  });
  it('other addresses and no internal address are left alone', () => {
    expect(
      toInternalUrl(
        'https://elsewhere.test/x',
        'http://localhost:8090/sso',
        'http://127.0.0.1:9300',
      ),
    ).toBe('https://elsewhere.test/x');
    expect(
      toInternalUrl('http://localhost:8090/sso/x', 'http://localhost:8090/sso', undefined),
    ).toBe('http://localhost:8090/sso/x');
  });
});

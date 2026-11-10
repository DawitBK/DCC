import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env';
import { LocalDevSecretsProvider } from './crypto/secrets';
import { redact } from './observability/logger';
import { safeReturnTo } from './auth/oidc.service';

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

  it('requires the Postiz settings when the Postiz engine is selected', () => {
    expect(() => loadConfig({ ...base, ENGINE_PROVIDER: 'postiz' })).toThrow(/POSTIZ_BASE_URL/);
  });
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

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/env';
import { addKeyToFile, KeyFileSecretsProvider, readKeyRing } from './secrets';

const newFile = () => join(mkdtempSync(join(tmpdir(), 'dcc-keys-')), 'dcc.keys.json');

describe('key-file secrets provider (ADR-0007, L-17)', () => {
  it('round-trips, is production grade, and binds the purpose', async () => {
    const file = newFile();
    addKeyToFile(file);
    const secrets = new KeyFileSecretsProvider(file);
    expect(secrets.productionGrade).toBe(true);
    const sealed = await secrets.encrypt('id-token-value', 'session.id_token');
    expect(sealed).not.toContain('id-token-value');
    expect(await secrets.decrypt(sealed, 'session.id_token')).toBe('id-token-value');
    await expect(secrets.decrypt(sealed, 'something.else')).rejects.toThrow();
  });

  it('rotation: new data uses the new key, old data still opens, and a removed key is named', async () => {
    const file = newFile();
    const first = addKeyToFile(file, new Date('2026-11-13T00:00:00Z'));
    const old = await new KeyFileSecretsProvider(file).encrypt('made before rotation', 'c');

    const second = addKeyToFile(file, new Date('2026-11-13T00:00:00Z'));
    expect(second).not.toBe(first);
    expect(readKeyRing(file).active).toBe(second);

    const rotated = new KeyFileSecretsProvider(file);
    expect(await rotated.decrypt(old, 'c')).toBe('made before rotation');
    const fresh = await rotated.encrypt('made after rotation', 'c');
    expect(fresh.split('.')[1]).toBe(second);

    // Retire the first key: data made with it can no longer be read, and the error says which key.
    const ring = readKeyRing(file);
    delete ring.keys[first];
    writeFileSync(file, JSON.stringify(ring), { mode: 0o600 });
    const retired = new KeyFileSecretsProvider(file);
    await expect(retired.decrypt(old, 'c')).rejects.toThrow(new RegExp(first));
    expect(await retired.decrypt(fresh, 'c')).toBe('made after rotation');
  });

  it('a ciphertext relabelled with another key id, or altered, does not open', async () => {
    const file = newFile();
    const first = addKeyToFile(file, new Date('2026-11-13T00:00:00Z'));
    const sealed = await new KeyFileSecretsProvider(file).encrypt('x', 'c');
    const second = addKeyToFile(file, new Date('2026-11-13T00:00:00Z'));
    const secrets = new KeyFileSecretsProvider(file);

    const parts = sealed.split('.');
    expect(parts[1]).toBe(first);
    await expect(
      secrets.decrypt([parts[0], second, ...parts.slice(2)].join('.'), 'c'),
    ).rejects.toThrow();
    parts[4] = Buffer.from('tampered').toString('base64url');
    await expect(secrets.decrypt(parts.join('.'), 'c')).rejects.toThrow();
    await expect(secrets.decrypt('v1.a.b.c', 'c')).rejects.toThrow(/Unrecognised/);
  });

  it('refuses a bad key file without ever echoing key material', () => {
    expect(() => new KeyFileSecretsProvider('relative/path.json')).toThrow(/absolute/);
    expect(() => new KeyFileSecretsProvider(join(tmpdir(), 'dcc-no-such-file.json'))).toThrow(
      /not found/,
    );
    const file = newFile();
    writeFileSync(file, '{ not json', { mode: 0o600 });
    expect(() => readKeyRing(file)).toThrow(/not valid JSON/);
    const shortKey = Buffer.alloc(8, 1).toString('base64');
    writeFileSync(file, JSON.stringify({ active: 'k1', keys: { k1: shortKey } }), { mode: 0o600 });
    let message = '';
    try {
      readKeyRing(file);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/32 bytes/);
    expect(message).not.toContain(shortKey);
    writeFileSync(
      file,
      JSON.stringify({ active: 'missing', keys: { k1: Buffer.alloc(32, 1).toString('base64') } }),
      { mode: 0o600 },
    );
    expect(() => readKeyRing(file)).toThrow(/active key/);
  });

  it('the key file never holds the key under a predictable name twice', () => {
    const file = newFile();
    const day = new Date('2026-11-13T00:00:00Z');
    const ids = [addKeyToFile(file, day), addKeyToFile(file, day), addKeyToFile(file, day)];
    expect(new Set(ids).size).toBe(3);
    const ring = JSON.parse(readFileSync(file, 'utf8'));
    expect(new Set(Object.values(ring.keys)).size).toBe(3);
  });
});

describe('configuration: which secrets provider may run where', () => {
  const production = {
    NODE_ENV: 'production',
    DCC_DATABASE_URL: 'postgres://dcc_app:Xk29fjq0aLmZ@db.internal:5432/dcc',
    OIDC_CLIENT_SECRET: 'a-real-looking-client-secret-0123456789',
    DCC_WEB_ORIGIN: 'https://portal.kerchanshe.test',
    OIDC_ISSUER: 'https://portal.kerchanshe.test/sso',
    OIDC_REDIRECT_URI: 'https://portal.kerchanshe.test/dcc/api/auth/callback',
    OIDC_POST_LOGOUT_URI: 'https://portal.kerchanshe.test/dcc/',
  };

  it('production starts with the key file and refuses the development provider', () => {
    const file = newFile();
    const cfg = loadConfig({ ...production, SECRETS_PROVIDER: 'key-file', DCC_KEY_FILE: file });
    expect(cfg.SECRETS_PROVIDER).toBe('key-file');
    expect(cfg.isProduction).toBe(true);
    expect(() =>
      loadConfig({
        ...production,
        SECRETS_PROVIDER: 'local-dev',
        DCC_LOCAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      }),
    ).toThrow(/SECRETS_PROVIDER=local-dev is not allowed in production/);
  });

  it('key-file needs an absolute path', () => {
    expect(() => loadConfig({ ...production, SECRETS_PROVIDER: 'key-file' })).toThrow(
      /needs DCC_KEY_FILE/,
    );
    expect(() =>
      loadConfig({ ...production, SECRETS_PROVIDER: 'key-file', DCC_KEY_FILE: 'keys.json' }),
    ).toThrow(/absolute path/);
  });
});

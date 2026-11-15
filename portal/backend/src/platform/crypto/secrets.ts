import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export const SECRETS = Symbol('SECRETS');

/**
 * The seam for key management (ADR-0007). Application code only ever calls encrypt/decrypt; WHERE the
 * key lives is the provider's business. Decision D-05 / ADR-0007: production starts with a key file on
 * the server (`KeyFileSecretsProvider` below); a key service (Azure Key Vault, HashiCorp Vault) can
 * replace it later behind this same interface without touching any caller.
 */
export interface SecretsProvider {
  readonly name: string;
  /** True only for providers fit for production. */
  readonly productionGrade: boolean;
  encrypt(plaintext: string, context: string): Promise<string>;
  decrypt(ciphertext: string, context: string): Promise<string>;
}

/**
 * Development only. AES-256-GCM with a key taken from an environment variable. Its `productionGrade`
 * flag is false and the configuration loader refuses it in production, so it cannot be mistaken for
 * real key management. `context` is bound as additional authenticated data: a ciphertext made for one
 * purpose (e.g. "session.id_token") will not decrypt for another.
 */
export class LocalDevSecretsProvider implements SecretsProvider {
  readonly name = 'local-dev';
  readonly productionGrade = false;
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32)
      throw new Error('DCC_LOCAL_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  }

  async encrypt(plaintext: string, context: string): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      body.toString('base64url'),
    ].join('.');
  }

  async decrypt(ciphertext: string, context: string): Promise<string> {
    const [version, iv, tag, body] = ciphertext.split('.');
    if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unrecognised ciphertext format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

export interface KeyRing {
  /** The key new data is encrypted with. */
  active: string;
  /** Every key that may still be needed to read old data: id -> 32 bytes, base64. */
  keys: Record<string, string>;
}

const KEY_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Production provider (ADR-0007, decision D-05): AES-256-GCM with keys from a file that lives on the
 * server, outside the repository, readable only by the account DCC runs as.
 *
 * The file is a small key ring, so a key can be ROTATED without losing old data: add a new key, make
 * it `active`, restart. New data uses the new key; anything encrypted earlier names the key it was
 * made with and still opens. Remove an old key only when nothing encrypted with it is left (stored
 * id_tokens die with their sessions, at most SESSION_TTL_MINUTES later).
 *
 * What this does and does not protect: the key is not in the environment, not in the database and not
 * in any backup of them, so a leaked dump or env file alone opens nothing. Someone who can read files
 * as the DCC service account can read the key: that is the accepted limit of a key file.
 */
export class KeyFileSecretsProvider implements SecretsProvider {
  readonly name = 'key-file';
  readonly productionGrade = true;
  private readonly keys = new Map<string, Buffer>();
  private readonly active: string;

  constructor(path: string) {
    const ring = readKeyRing(path);
    for (const [id, value] of Object.entries(ring.keys))
      this.keys.set(id, Buffer.from(value, 'base64'));
    this.active = ring.active;
  }

  async encrypt(plaintext: string, context: string): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.active)!, iv);
    // The key id is authenticated too: a ciphertext cannot be relabelled as made with another key.
    cipher.setAAD(Buffer.from(`${this.active}|${context}`));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      'v2',
      this.active,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      body.toString('base64url'),
    ].join('.');
  }

  async decrypt(ciphertext: string, context: string): Promise<string> {
    const [version, keyId, iv, tag, body] = ciphertext.split('.');
    if (version !== 'v2' || !keyId || !iv || !tag || !body)
      throw new Error('Unrecognised ciphertext format');
    const key = this.keys.get(keyId);
    if (!key)
      throw new Error(`The key "${keyId}" this data was encrypted with is not in the key file`);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`${keyId}|${context}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

/** Reads and checks a key file. Error messages never contain key material. */
export function readKeyRing(path: string): KeyRing {
  if (!isAbsolute(path)) throw new Error('DCC_KEY_FILE must be an absolute path');
  if (!existsSync(path)) throw new Error(`Key file not found: ${path}`);
  // POSIX: refuse a file other accounts can read. Windows has no mode bits: restrict it with icacls
  // (docs/devops/SECRETS-AND-KEYS.md); that cannot be checked from here.
  if (process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0)
    throw new Error(`Key file ${path} is readable by other accounts: run chmod 600 on it`);
  let ring: KeyRing;
  try {
    ring = JSON.parse(readFileSync(path, 'utf8')) as KeyRing;
  } catch {
    throw new Error(`Key file ${path} is not valid JSON`);
  }
  if (!ring || typeof ring.active !== 'string' || typeof ring.keys !== 'object' || !ring.keys)
    throw new Error(`Key file ${path} must have "active" and "keys"`);
  for (const [id, value] of Object.entries(ring.keys)) {
    if (!KEY_ID.test(id)) throw new Error(`Key file ${path}: "${id}" is not a valid key id`);
    if (typeof value !== 'string' || Buffer.from(value, 'base64').length !== 32)
      throw new Error(`Key file ${path}: key "${id}" must be 32 bytes, base64 encoded`);
  }
  if (!ring.keys[ring.active])
    throw new Error(`Key file ${path}: the active key "${ring.active}" is not in "keys"`);
  return ring;
}

/**
 * Creates the key file, or adds a fresh key to an existing one and makes it the active key (rotation).
 * Old keys are kept so earlier data still opens. Returns the id of the new key, never the key.
 */
export function addKeyToFile(path: string, now: Date = new Date()): string {
  if (!isAbsolute(path)) throw new Error('The key file path must be absolute');
  const ring: KeyRing = existsSync(path) ? readKeyRing(path) : { active: '', keys: {} };
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  let id = `k${stamp}`;
  for (let n = 2; ring.keys[id]; n++) id = `k${stamp}-${n}`;
  ring.keys[id] = randomBytes(32).toString('base64');
  ring.active = id;
  writeFileSync(path, `${JSON.stringify(ring, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return id;
}

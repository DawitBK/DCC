import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const SECRETS = Symbol('SECRETS');

/**
 * The seam for key management (ADR-0007). Application code only ever calls encrypt/decrypt; WHERE the
 * key lives is the provider's business. Production uses a key service (Azure Key Vault, HashiCorp
 * Vault, or equivalent) behind this same interface. NOT DECIDED YET: see docs/project/OPEN-DECISIONS.md D-05.
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

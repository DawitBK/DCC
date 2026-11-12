import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { SECRETS, type SecretsProvider } from '../crypto/secrets';
import { DATABASE, type Database } from '../database/database';

export interface SessionRecord {
  userId: string;
  hasIdToken: boolean;
  /** When the person last proved who they are at the SSO. Null = not known (treated as "not recently"). */
  authenticatedAt: Date | null;
}

/** Has this session's owner proved who they are within the last `maxAgeMinutes`? */
export function authenticatedRecently(
  authenticatedAt: Date | null,
  maxAgeMinutes: number,
  now: Date = new Date(),
): boolean {
  if (!authenticatedAt) return false;
  return now.getTime() - authenticatedAt.getTime() <= maxAgeMinutes * 60_000;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const TOUCH_AFTER_MS = 60_000;

/**
 * Server-side sessions. The cookie carries a random 256-bit id; the database stores only its SHA-256,
 * so a database leak does not yield usable session ids. Absolute lifetime and idle timeout are both
 * enforced. The IdP id_token (needed only as the logout hint) is stored encrypted; DCC never holds
 * the IdP's access or refresh tokens.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SECRETS) private readonly secrets: SecretsProvider,
  ) {}

  async create(input: {
    userId: string;
    idToken?: string;
    idpSid?: string;
    ip?: string;
    userAgent?: string;
    /**
     * When the person proved who they are. A real sign-in passes the IdP's `auth_time`, or null when the
     * IdP did not say. Left out (tests, tools that create a session directly) it means "now".
     */
    authenticatedAt?: Date | null;
  }) {
    const id = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_MINUTES * 60_000);
    const idTokenEnc = input.idToken
      ? await this.secrets.encrypt(input.idToken, 'session.id_token')
      : null;
    await this.database.db
      .insertInto('sessions')
      .values({
        id_hash: sha256(id),
        user_id: input.userId,
        expires_at: expiresAt,
        id_token_enc: idTokenEnc,
        idp_sid: input.idpSid ?? null,
        ip: input.ip ?? null,
        user_agent: input.userAgent?.slice(0, 300) ?? null,
        authenticated_at: input.authenticatedAt === undefined ? new Date() : input.authenticatedAt,
      })
      .execute();
    // Housekeeping, off the request path's critical result.
    void this.purgeExpired().catch(() => undefined);
    return { id, expiresAt };
  }

  /** Returns the session if it is valid right now (absolute expiry and idle timeout), otherwise null. */
  async find(rawId: string): Promise<SessionRecord | null> {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(rawId)) return null;
    const row = await this.database.db
      .selectFrom('sessions')
      .select(['user_id', 'expires_at', 'last_seen_at', 'id_token_enc', 'authenticated_at'])
      .where('id_hash', '=', sha256(rawId))
      .executeTakeFirst();
    if (!row) return null;

    const now = Date.now();
    const idleLimit = now - this.config.SESSION_IDLE_MINUTES * 60_000;
    if (row.expires_at.getTime() <= now || row.last_seen_at.getTime() < idleLimit) {
      await this.destroy(rawId);
      return null;
    }
    if (now - row.last_seen_at.getTime() > TOUCH_AFTER_MS) {
      await this.database.db
        .updateTable('sessions')
        .set({ last_seen_at: new Date() })
        .where('id_hash', '=', sha256(rawId))
        .execute();
    }
    return {
      userId: row.user_id,
      hasIdToken: row.id_token_enc !== null,
      authenticatedAt: row.authenticated_at,
    };
  }

  async idTokenHint(rawId: string): Promise<string | null> {
    const row = await this.database.db
      .selectFrom('sessions')
      .select('id_token_enc')
      .where('id_hash', '=', sha256(rawId))
      .executeTakeFirst();
    if (!row?.id_token_enc) return null;
    return this.secrets.decrypt(row.id_token_enc, 'session.id_token');
  }

  async destroy(rawId: string): Promise<void> {
    await this.database.db.deleteFrom('sessions').where('id_hash', '=', sha256(rawId)).execute();
  }

  /** Back-channel logout and account disablement: end every session of a person. Returns how many ended. */
  async destroyAllForSubject(idpSubject: string): Promise<number> {
    // Through a SECURITY DEFINER function: `users` is RLS-protected and a logout notification has no tenant context.
    const { rows } = await sql<{
      n: number;
    }>`select auth_end_sessions_for_subject(${idpSubject}) as n`.execute(this.database.db);
    return rows[0]?.n ?? 0;
  }

  async destroyByIdpSid(idpSid: string): Promise<number> {
    const rows = await this.database.db
      .deleteFrom('sessions')
      .where('idp_sid', '=', idpSid)
      .returning('id_hash')
      .execute();
    return rows.length;
  }

  async purgeExpired(): Promise<void> {
    await this.database.db.deleteFrom('sessions').where('expires_at', '<', new Date()).execute();
    await this.database.db
      .deleteFrom('auth_transactions')
      .where('expires_at', '<', new Date())
      .execute();
  }
}

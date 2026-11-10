import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env';
import { SessionService } from '../src/platform/auth/session.service';
import { LocalDevSecretsProvider } from '../src/platform/crypto/secrets';
import { createDatabase, type Database } from '../src/platform/database/database';
import { appUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

/**
 * Regression: ending sessions by IdP subject (back-channel logout) once matched nothing, because the
 * lookup read the RLS-protected `users` table with no tenant context. Found by a real login against the
 * dev SSO, which a mocked test had missed.
 */
describe('sessions', () => {
  let database: Database;
  let sessions: SessionService;
  let f: Fixture;

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    database = createDatabase(appUrl(), 2);
    const config = loadConfig();
    sessions = new SessionService(
      database,
      config,
      new LocalDevSecretsProvider(config.DCC_LOCAL_ENCRYPTION_KEY!),
    );
  });
  afterAll(async () => {
    await database.close();
  });

  it('ends every session of one person by IdP subject and leaves other people alone', async () => {
    const a1 = await sessions.create({ userId: f.users.adminA });
    const a2 = await sessions.create({ userId: f.users.adminA });
    const b = await sessions.create({ userId: f.users.creatorB });
    expect(await sessions.destroyAllForSubject('sub-admin-a')).toBe(2);
    expect(await sessions.find(a1.id)).toBeNull();
    expect(await sessions.find(a2.id)).toBeNull();
    expect(await sessions.find(b.id)).not.toBeNull();
  });

  it('an unknown subject ends nothing', async () => {
    expect(await sessions.destroyAllForSubject('sub-nobody')).toBe(0);
  });

  it('ends by IdP session id', async () => {
    const s = await sessions.create({ userId: f.users.auditorA, idpSid: 'sid-123' });
    expect(await sessions.destroyByIdpSid('sid-123')).toBe(1);
    expect(await sessions.find(s.id)).toBeNull();
  });

  it('the stored id is a hash: the raw cookie value is not in the database', async () => {
    const s = await sessions.create({ userId: f.users.outsider });
    const { rows } = await database.pool.query(`select id_hash from sessions where user_id = $1`, [
      f.users.outsider,
    ]);
    expect(rows.map((r) => r.id_hash)).not.toContain(s.id);
    expect(rows[0].id_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the IdP id_token encrypted at rest and only returns it as a logout hint', async () => {
    const s = await sessions.create({
      userId: f.users.groupAdmin,
      idToken: 'header.payload.signature',
    });
    const { rows } = await database.pool.query(
      `select id_token_enc from sessions where user_id = $1`,
      [f.users.groupAdmin],
    );
    expect(rows[0].id_token_enc).not.toContain('payload');
    expect(await sessions.idTokenHint(s.id)).toBe('header.payload.signature');
  });
});

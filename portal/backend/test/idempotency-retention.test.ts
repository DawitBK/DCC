import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/platform/database/database';
import {
  cutoffFor,
  MIN_DAYS,
  parseDays,
  pruneIdempotencyKeys,
  RetentionInputError,
} from '../src/platform/maintenance/idempotency-retention';
import { appUrl, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

/**
 * H-15: the retention rule for idempotency_keys. Only `done` keys older than the cutoff that no publication still
 * waits on may go; never in_progress or unknown; dry run by default; an applied run leaves one audit event.
 */
describe('idempotency key retention (H-15)', () => {
  let f: Fixture;
  let database: Database;
  let app: pg.Client; // the runtime role: what the command uses

  const owner = async <T>(work: (c: pg.Client) => Promise<T>): Promise<T> => {
    const c = new pg.Client({ connectionString: ownerUrl() });
    await c.connect();
    try {
      return await work(c);
    } finally {
      await c.end();
    }
  };
  const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const keys = async () =>
    (await owner((c) => c.query(`select key, state from idempotency_keys order by key`))).rows.map(
      (r) => `${r.key}:${r.state}`,
    );

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    database = createDatabase(appUrl(), 1);
    app = new pg.Client({ connectionString: appUrl() });
    await app.connect();
  });
  afterAll(async () => {
    await app.end();
    await database.close();
  });

  /** One key, with the age of its last update, optionally with the publication that owns it. */
  const addKey = async (
    key: string,
    state: 'done' | 'in_progress' | 'unknown',
    ageDays: number,
    publication?: 'pending' | 'scheduled' | 'published' | 'failed',
  ) =>
    owner(async (c) => {
      await c.query(
        `insert into idempotency_keys (key, state, result, created_at, updated_at) values ($1, $2, '{}'::jsonb, $3, $3)`,
        [key, state, days(ageDays)],
      );
      if (!publication) return;
      const item = (
        await c.query(
          `insert into content_items (company_id, created_by) values ($1, $2) returning id`,
          [f.companyA, f.users.adminA],
        )
      ).rows[0].id;
      const version = (
        await c.query(
          `insert into content_versions (content_item_id, company_id, version_number, body, created_by) values ($1, $2, 1, 'Body', $3) returning id`,
          [item, f.companyA, f.users.adminA],
        )
      ).rows[0].id;
      await c.query(
        `insert into publications (company_id, content_item_id, content_version_id, social_account_id, requested_by, idempotency_key, status)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [f.companyA, item, version, f.accountA, f.users.adminA, key, publication],
      );
    });

  beforeAll(async () => {
    await addKey('old-done-1', 'done', 200);
    await addKey('old-done-2', 'done', 100);
    await addKey('old-done-published', 'done', 150, 'published');
    await addKey('old-done-failed', 'done', 150, 'failed');
    await addKey('old-done-scheduled', 'done', 150, 'scheduled'); // a publication still waits: kept
    await addKey('old-done-pending', 'done', 150, 'pending'); // kept
    await addKey('recent-done', 'done', 10); // too new: kept
    await addKey('old-in-progress', 'in_progress', 300); // never touched
    await addKey('old-unknown', 'unknown', 300); // never touched
  });

  it('input: days must be given, whole, and at least 30; there is no default', () => {
    expect(MIN_DAYS).toBe(30);
    for (const bad of [undefined, '', 'abc', '1.5', '-5', '0', '29', '100000', ' ', '9e9'])
      expect(() => parseDays(bad), String(bad)).toThrow(RetentionInputError);
    expect(parseDays('30')).toBe(30);
    expect(parseDays(' 90 ')).toBe(90);
    const now = new Date('2026-11-24T12:00:00Z');
    expect(cutoffFor(90, now).toISOString()).toBe('2026-08-26T12:00:00.000Z');
  });

  it('a dry run counts, changes nothing and writes no audit event', async () => {
    const before = await keys();
    const report = await pruneIdempotencyKeys(app, { days: 90, apply: false });
    expect(report).toMatchObject({
      applied: false,
      doneTotal: 7,
      eligible: 4, // old-done-1, old-done-2, published, failed
      keptRecent: 1,
      keptUnsettledPublication: 2,
      inProgress: 1,
      unknown: 1,
      removed: 0,
      auditEventId: null,
    });
    expect(await keys()).toEqual(before);
    const audit = await owner((c) =>
      c.query(`select count(*)::int as n from audit_events where action like 'maintenance.%'`),
    );
    expect(audit.rows[0].n).toBe(0);
  });

  it('the database refuses a cutoff that is too recent, whatever the caller says', async () => {
    await expect(app.query(`select * from idempotency_prune(now(), true)`)).rejects.toThrow(
      /at least 30 days/,
    );
    await expect(
      app.query(`select * from idempotency_prune(now() - interval '29 days', true)`),
    ).rejects.toThrow(/at least 30 days/);
    await expect(app.query(`select * from idempotency_prune(null, true)`)).rejects.toThrow();
    expect(await keys()).toHaveLength(9);
  });

  it('a cutoff of 160 days removes only what is older, settled and done', async () => {
    const report = await pruneIdempotencyKeys(app, { days: 160, apply: false });
    expect(report.eligible).toBe(1); // only old-done-1 (200 days)
    const applied = await pruneIdempotencyKeys(app, { days: 160, apply: true });
    expect(applied).toMatchObject({ applied: true, removed: 1, auditEventId: expect.any(String) });
    expect(await keys()).not.toContain('old-done-1:done');
    expect(await keys()).toHaveLength(8);
  });

  it('apply with 90 days removes the rest of the eligible keys and leaves everything else', async () => {
    const report = await pruneIdempotencyKeys(app, { days: 90, apply: true });
    expect(report).toMatchObject({
      applied: true,
      removed: 3,
      eligible: 3,
      keptRecent: 1,
      keptUnsettledPublication: 2,
      inProgress: 1,
      unknown: 1,
    });
    expect(report.oldestRemoved && report.newestRemoved).toBeTruthy();
    expect(await keys()).toEqual([
      'old-done-pending:done',
      'old-done-scheduled:done',
      'old-in-progress:in_progress',
      'old-unknown:unknown',
      'recent-done:done',
    ]);
    // the publications themselves are untouched
    const pubs = await owner((c) => c.query(`select count(*)::int as n from publications`));
    expect(pubs.rows[0].n).toBe(4);
  });

  it('every applied run is one audit event with counts, cutoff and a digest, never the keys; the chain still verifies', async () => {
    const events = (
      await owner((c) =>
        c.query(
          `select actor_user_id, actor_subject, company_id, details from audit_events where action = 'maintenance.idempotency_keys_pruned' order by id`,
        ),
      )
    ).rows;
    expect(events).toHaveLength(2);
    expect(events[0].actor_user_id).toBeNull();
    expect(events[0].actor_subject).toBe('maintenance:idempotency-prune');
    expect(events[1].details).toMatchObject({
      removed: 3,
      eligibleBefore: 3,
      keptRecent: 1,
      keptUnsettledPublication: 2,
      inProgressUntouched: 1,
      unknownUntouched: 1,
      removedKeysSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      cutoff: expect.any(String),
    });
    expect(JSON.stringify(events)).not.toContain('old-done-2');
    const chain = await app.query(`select * from audit_verify()`);
    expect(chain.rows[0].ok).toBe(true);
    // an apply that finds nothing is recorded too
    const none = await pruneIdempotencyKeys(app, { days: 90, apply: true });
    expect(none.removed).toBe(0);
    expect(none.auditEventId).toEqual(expect.any(String));
  });

  it('a done key whose publication is settled later becomes eligible; a scheduled one never goes while it waits', async () => {
    await owner((c) =>
      c.query(
        `update publications set status = 'published' where idempotency_key = 'old-done-scheduled'`,
      ),
    );
    const report = await pruneIdempotencyKeys(app, { days: 90, apply: true });
    expect(report.removed).toBe(1);
    expect(await keys()).not.toContain('old-done-scheduled:done');
    expect(await keys()).toContain('old-done-pending:done');
  });
});

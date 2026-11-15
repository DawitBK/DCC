import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/platform/audit/audit.service';
import {
  appendCheckpoint,
  readCheckpoints,
  takeCheckpoint,
  verifyCheckpoints,
} from '../src/platform/audit/checkpoint';
import { createDatabase, type Database } from '../src/platform/database/database';
import { appUrl, ownerUrl, resetTestDatabase } from './helpers';

/**
 * L-09 / D-06: the case audit_verify() alone cannot see. A privileged insider switches the append-only
 * trigger off and rewrites the trail with freshly computed hashes, so the chain is consistent again.
 * A checkpoint taken earlier and kept elsewhere still shows it.
 */
describe('audit checkpoints', () => {
  let database: Database;
  let audit: AuditService;
  const KEY = 'test-sealing-key';

  const asOwner = async <T>(work: (c: pg.Client) => Promise<T>): Promise<T> => {
    const c = new pg.Client({ connectionString: ownerUrl() });
    await c.connect();
    try {
      return await work(c);
    } finally {
      await c.end();
    }
  };
  /** What a database insider can do: no trigger, every row re-hashed so the chain verifies again. */
  const rewriteTrailConsistently = (change: string) =>
    asOwner(async (c) => {
      await c.query('alter table audit_events disable trigger user');
      await c.query(change);
      const rows = (await c.query('select id from audit_events order by id')).rows;
      let prev = '0'.repeat(64);
      for (const { id } of rows) {
        const r = await c.query(
          `update audit_events a set prev_hash = $2,
             hash = audit_compute_hash($2, a.occurred_at, a.actor_user_id, a.actor_subject, a.action,
                      a.target_type, a.target_id, a.company_id, a.correlation_id, a.ip, a.details)
           where a.id = $1 returning hash`,
          [id, prev],
        );
        prev = r.rows[0].hash;
      }
      await c.query('alter table audit_events enable trigger user');
    });
  const record = (n: number) =>
    audit.recordStandalone({ action: 'test.checkpoint_event', details: { n } });

  beforeAll(async () => {
    await resetTestDatabase();
    database = createDatabase(appUrl(), 2);
    audit = new AuditService(database);
  });
  afterAll(async () => {
    await database.close();
  });

  it('an empty trail can be checkpointed (first line, nothing to compare yet)', async () => {
    const first = await takeCheckpoint(database.pool, { key: KEY });
    expect(first).toMatchObject({ lastId: 0, events: 0, chainOk: true, prev: '0'.repeat(64) });
    expect((await verifyCheckpoints(database.pool, [first], { key: KEY })).ok).toBe(true);
  });

  it('the runtime role can take one, and it still agrees after more events are appended', async () => {
    for (let n = 1; n <= 3; n++) await record(n);
    const first = await takeCheckpoint(database.pool, { key: KEY });
    expect(first).toMatchObject({ events: 3, chainOk: true });
    expect(first.lastHash).toMatch(/^[0-9a-f]{64}$/);
    await record(4);
    const second = await takeCheckpoint(database.pool, { previous: first, key: KEY });
    expect(second.prev).toBe(first.seal);
    expect(second.events).toBe(4);

    const report = await verifyCheckpoints(database.pool, [first, second], { key: KEY });
    expect(report).toEqual({ ok: true, checked: 2, problems: [] });
  });

  it('survives a round trip through the file', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dcc-cp-')), 'audit-checkpoints.jsonl');
    const first = await takeCheckpoint(database.pool, { key: KEY });
    appendCheckpoint(file, first);
    appendCheckpoint(file, await takeCheckpoint(database.pool, { previous: first, key: KEY }));
    const read = readCheckpoints(file);
    expect(read).toHaveLength(2);
    expect((await verifyCheckpoints(database.pool, read, { key: KEY })).ok).toBe(true);
  });

  it('an edited, dropped or re-sealed line in the file is noticed', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dcc-cp-')), 'audit-checkpoints.jsonl');
    const a = await takeCheckpoint(database.pool, { key: KEY });
    await record(5);
    const b = await takeCheckpoint(database.pool, { previous: a, key: KEY });
    await record(6);
    const c = await takeCheckpoint(database.pool, { previous: b, key: KEY });
    for (const cp of [a, b, c]) appendCheckpoint(file, cp);
    const problemsOf = async (checkpoints: Parameters<typeof verifyCheckpoints>[1]) =>
      (await verifyCheckpoints(database.pool, checkpoints, { key: KEY })).problems.join(' ');

    // edited: someone lowers the event count in the middle line
    expect(await problemsOf([a, { ...b, events: b.events - 1 }, c])).toMatch(/seal does not match/);
    // dropped: the middle line removed
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    writeFileSync(file, `${lines[0]}\n${lines[2]}\n`);
    expect(await problemsOf(readCheckpoints(file))).toMatch(/missing, reordered or was replaced/);
    // re-sealed without the key: a forger rebuilds the line with the plain hash
    expect(await problemsOf([await takeCheckpoint(database.pool, {})])).toMatch(
      /seal does not match/,
    );
    // damaged file
    writeFileSync(file, 'not json\n');
    expect(() => readCheckpoints(file)).toThrow(/damaged or edited/);
  });

  it('a full rewrite of the trail by a database insider passes audit_verify but fails the checkpoint', async () => {
    const before = await takeCheckpoint(database.pool, { key: KEY });

    await rewriteTrailConsistently(
      `update audit_events set action = 'test.rewritten' where id = (select min(id) from audit_events)`,
    );

    // The forged chain is internally consistent: this is exactly the gap a checkpoint closes.
    expect((await audit.verifyChain()).ok).toBe(true);

    const report = await verifyCheckpoints(database.pool, [before], { key: KEY });
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/the audit trail was rewritten/);
  });

  it('removing the newest events is noticed too', async () => {
    const before = await takeCheckpoint(database.pool, { key: KEY });
    await rewriteTrailConsistently(
      `delete from audit_events where id = (select max(id) from audit_events)`,
    );
    expect((await audit.verifyChain()).ok).toBe(true);

    const report = await verifyCheckpoints(database.pool, [before], { key: KEY });
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/events were removed/);
  });
});

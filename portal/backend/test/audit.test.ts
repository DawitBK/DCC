import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { AuditService } from '../src/platform/audit/audit.service';
import { createDatabase, type Database } from '../src/platform/database/database';
import { TenantDb } from '../src/platform/tenancy/tenant-db';
import { appUrl, ctx, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

describe('audit trail', () => {
  let database: Database;
  let audit: AuditService;
  let tenant: TenantDb;
  let f: Fixture;

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    database = createDatabase(appUrl(), 2);
    audit = new AuditService(database);
    tenant = new TenantDb(database);
    await audit.recordStandalone({
      action: 'test.event_one',
      actorUserId: f.users.adminA,
      companyId: f.companyA,
      details: { n: 1 },
    });
    await audit.recordStandalone({
      action: 'test.event_two',
      actorUserId: f.users.creatorB,
      companyId: f.companyB,
      details: { n: 2 },
    });
    await audit.recordStandalone({
      action: 'test.event_three',
      actorUserId: f.users.groupAdmin,
      details: { n: 3 },
    });
  });
  afterAll(async () => {
    await database.close();
  });

  it('the runtime role cannot update, delete or truncate audit rows', async () => {
    await expect(database.pool.query(`update audit_events set action = 'x'`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(database.pool.query(`delete from audit_events`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(database.pool.query(`truncate audit_events`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      database.pool.query(
        `insert into audit_events (occurred_at, action, prev_hash, hash) values (now(), 'forged', 'x', 'y')`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('even the table owner is stopped by accident (append-only trigger)', async () => {
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    try {
      await expect(owner.query(`update audit_events set action = 'x'`)).rejects.toThrow(
        /append-only/,
      );
      await expect(owner.query(`delete from audit_events`)).rejects.toThrow(/append-only/);
    } finally {
      await owner.end();
    }
  });

  it('the hash chain verifies when untouched', async () => {
    expect(await audit.verifyChain()).toEqual({ ok: true, checked: 3, firstBrokenId: null });
  });

  it('visibility follows tenant scope: company A cannot read company B events', async () => {
    const seen = await tenant.run(ctx(f.users.adminA, [], [f.companyA]), (trx) =>
      trx.selectFrom('audit_events').select('action').orderBy('id').execute(),
    );
    expect(seen.map((e) => e.action)).toEqual(['test.event_one']);
    const group = await tenant.run(ctx(f.users.groupAdmin, [f.groupId], []), (trx) =>
      trx.selectFrom('audit_events').select('action').orderBy('id').execute(),
    );
    expect(group.map((e) => e.action)).toEqual([
      'test.event_one',
      'test.event_two',
      'test.event_three',
    ]);
  });

  it('an event written in a transaction that rolls back leaves no trace and does not break the chain', async () => {
    await expect(
      tenant.run(ctx(f.users.groupAdmin, [f.groupId], []), async (trx) => {
        await audit.record(trx, { action: 'test.rolled_back', actorUserId: f.users.groupAdmin });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await audit.verifyChain()).toMatchObject({ ok: true, checked: 3 });
  });

  it('concurrent writers keep one unbroken chain', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        audit.recordStandalone({ action: 'test.concurrent', details: { i } }),
      ),
    );
    expect(await audit.verifyChain()).toMatchObject({ ok: true, checked: 15 });
  });

  it('tampering by a privileged actor is DETECTED (not prevented): edit a row, verify names it', async () => {
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    try {
      const target = (
        await owner.query(`select id from audit_events where action = 'test.event_two'`)
      ).rows[0].id;
      await owner.query('alter table audit_events disable trigger audit_events_no_update_delete');
      await owner.query(`update audit_events set details = '{"n": 999}' where id = $1`, [target]);
      await owner.query('alter table audit_events enable trigger audit_events_no_update_delete');
      const result = await audit.verifyChain();
      expect(result.ok).toBe(false);
      expect(result.firstBrokenId).toBe(String(target));
    } finally {
      await owner.end();
    }
  });
});

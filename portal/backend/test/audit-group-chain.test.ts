import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { AuditService } from '../src/platform/audit/audit.service';
import { createDatabase, type Database } from '../src/platform/database/database';
import { TenantDb, type TenantContext } from '../src/platform/tenancy/tenant-db';
import { appUrl, ctx, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

/**
 * H-18: audit_events.group_id. What these prove, against the real migrations and PostgreSQL:
 *  - the hash of every event written BEFORE the column existed is unchanged (null group), so old chains and
 *    checkpoints still verify, and an old and a new event can sit in one chain;
 *  - group_id is INSIDE the hash of a new event: changing, removing or adding it on any row is detected;
 *  - which events get a group (explicit, else the actor's single group) and which stay without one;
 *  - the row-level policy: a group-level reader sees company-less events of their own group only, the platform
 *    owner also sees those without a group, nobody else sees any.
 */
describe('audit events carry a group (H-18)', () => {
  let database: Database;
  let audit: AuditService;
  let tenant: TenantDb;
  let f: Fixture;
  let multiGroupUser: string;
  const ids: Record<string, string> = {};

  const asOwner = async <T>(work: (c: pg.Client) => Promise<T>): Promise<T> => {
    const c = new pg.Client({ connectionString: ownerUrl() });
    await c.connect();
    try {
      return await work(c);
    } finally {
      await c.end();
    }
  };
  const row = (action: string) =>
    asOwner(
      async (c) =>
        (
          await c.query(`select * from audit_events where action = $1 order by id desc limit 1`, [
            action,
          ])
        ).rows[0],
    );
  /** The ORIGINAL 11-argument hash function, still in the database, applied to a stored row. */
  const oldFormulaHash = (id: string) =>
    asOwner(
      async (c) =>
        (
          await c.query(
            `select audit_compute_hash(a.prev_hash, a.occurred_at, a.actor_user_id, a.actor_subject, a.action,
                      a.target_type, a.target_id, a.company_id, a.correlation_id, a.ip, a.details) as h
               from audit_events a where a.id = $1`,
            [id],
          )
        ).rows[0].h as string,
    );

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    database = createDatabase(appUrl(), 2);
    audit = new AuditService(database);
    tenant = new TenantDb(database);
    multiGroupUser = await asOwner(async (c) => {
      const u = (
        await c.query(
          `insert into users (idp_subject, email, display_name) values ('sub-multi', 'multi@example.test', 'multi') returning id`,
        )
      ).rows[0].id as string;
      for (const g of [f.groupId, f.group2Id])
        await c.query(
          `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, null, 'auditor')`,
          [u, g],
        );
      return u;
    });

    // An "old-style" event: no company, no actor, no group: it hashes the way every event did before the column.
    await audit.recordStandalone({ action: 'test.legacy_style', details: { n: 0 } });
    await audit.recordStandalone({
      action: 'test.explicit_group',
      actorUserId: f.users.groupAdmin,
      groupId: f.group2Id, // the target's group wins over the actor's
      details: { n: 1 },
    });
    await audit.recordStandalone({
      action: 'test.actor_single_group',
      actorUserId: f.users.groupAdmin,
    });
    await audit.recordStandalone({
      action: 'test.actor_company_level',
      actorUserId: f.users.adminA,
    });
    await audit.recordStandalone({ action: 'test.actor_two_groups', actorUserId: multiGroupUser });
    await audit.recordStandalone({ action: 'test.no_actor' });
    await audit.recordStandalone({
      action: 'test.company_event',
      actorUserId: f.users.groupAdmin,
      companyId: f.companyA,
    });
    await audit.recordStandalone({
      action: 'test.other_group_actor',
      actorUserId: f.users.otherGroupAdmin,
    });
    ids.legacy = (await row('test.legacy_style')).id;
    ids.explicit = (await row('test.explicit_group')).id;
  });
  afterAll(async () => {
    await database.close();
  });

  it('an event without a group hashes exactly as before the column existed; the mixed chain verifies', async () => {
    const legacy = await row('test.legacy_style');
    expect(legacy.group_id).toBeNull();
    expect(legacy.hash).toBe(await oldFormulaHash(legacy.id));
    // ...and an event WITH a group does not hash like the old formula: the group is inside the hash.
    const withGroup = await row('test.explicit_group');
    expect(withGroup.group_id).toBe(f.group2Id);
    expect(withGroup.hash).not.toBe(await oldFormulaHash(withGroup.id));
    expect(await audit.verifyChain()).toMatchObject({ ok: true, checked: 8, firstBrokenId: null });
  });

  it('the 9-argument audit_append still works, gets the actor fallback and verifies', async () => {
    await asOwner((c) =>
      c.query(
        `select audit_append($1, null, 'test.nine_args', null, null, null, null, null, '{}'::jsonb)`,
        [f.users.groupAdmin],
      ),
    );
    expect((await row('test.nine_args')).group_id).toBe(f.groupId);
    expect(await audit.verifyChain()).toMatchObject({ ok: true, checked: 9 });
  });

  it('who gets a group: explicit wins; else the actor if in exactly one group; else none', async () => {
    expect((await row('test.explicit_group')).group_id).toBe(f.group2Id);
    expect((await row('test.actor_single_group')).group_id).toBe(f.groupId);
    expect((await row('test.actor_company_level')).group_id).toBe(f.groupId);
    expect((await row('test.other_group_actor')).group_id).toBe(f.group2Id);
    expect((await row('test.actor_two_groups')).group_id).toBeNull();
    expect((await row('test.no_actor')).group_id).toBeNull();
    // an event with a company is never stamped by the fallback
    expect((await row('test.company_event')).group_id).toBeNull();
  });

  const seen = (c: TenantContext) =>
    tenant
      .run(c, (trx) => trx.selectFrom('audit_events').select('action').orderBy('id').execute())
      .then((r) => r.map((e) => e.action));

  it('policy: a group-level reader sees company-less events of THEIR group only', async () => {
    const g1 = await seen(ctx(f.users.groupAdmin, [f.groupId], []));
    expect(g1).toContain('test.actor_single_group');
    expect(g1).toContain('test.company_event'); // a company of their group
    expect(g1).not.toContain('test.explicit_group'); // stamped with the OTHER group
    expect(g1).not.toContain('test.other_group_actor');
    expect(g1).not.toContain('test.legacy_style'); // no group
    expect(g1).not.toContain('test.no_actor');
    const g2 = await seen(ctx(f.users.otherGroupAdmin, [f.group2Id], []));
    expect(g2).toContain('test.explicit_group');
    expect(g2).toContain('test.other_group_actor');
    expect(g2).not.toContain('test.actor_single_group');
    expect(g2).not.toContain('test.company_event');
    expect(g2).not.toContain('test.legacy_style');
  });

  it('policy: rows with no group are read only by the platform owner; a company-level user reads no company-less row', async () => {
    const owner = await seen({
      ...ctx(f.users.groupAdmin, [f.groupId, f.group2Id], []),
      platformOwner: true,
    });
    expect(owner).toContain('test.legacy_style');
    expect(owner).toContain('test.no_actor');
    expect(owner).toContain('test.explicit_group');
    expect(owner).toContain('test.actor_single_group');
    // the same person without the flag does not
    const notOwner = await seen(ctx(f.users.groupAdmin, [f.groupId, f.group2Id], []));
    expect(notOwner).not.toContain('test.legacy_style');
    expect(notOwner).toContain('test.explicit_group'); // holds a role in both groups
    // company-level: only the company's own events
    expect(await seen(ctx(f.users.adminA, [], [f.companyA]))).toEqual(['test.company_event']);
    // a flag in the wrong form is not "true"
    const nobody = await tenant.run(ctx(f.users.outsider), async (trx) => {
      await sql`select set_config('app.platform_owner', 'yes', true)`.execute(trx);
      return trx.selectFrom('audit_events').select('action').execute();
    });
    expect(nobody).toEqual([]);
  });

  it('group_id is INSIDE the hash: changing, adding or removing it on any row is detected', async () => {
    const tamper = async (id: string, value: string | null) => {
      await asOwner(async (c) => {
        const before = (await c.query(`select group_id from audit_events where id = $1`, [id]))
          .rows[0].group_id;
        await c.query('alter table audit_events disable trigger audit_events_no_update_delete');
        try {
          await c.query(`update audit_events set group_id = $2 where id = $1`, [id, value]);
          const result = await audit.verifyChain();
          expect(result.ok, `${before} -> ${value}`).toBe(false);
          expect(result.firstBrokenId).toBe(String(id));
        } finally {
          await c.query(`update audit_events set group_id = $2 where id = $1`, [id, before]);
          await c.query('alter table audit_events enable trigger audit_events_no_update_delete');
        }
      });
    };
    await tamper(ids.explicit!, f.groupId); // moved to another group
    await tamper(ids.explicit!, null); // group removed
    await tamper(ids.legacy!, f.groupId); // a group added to an old event (would widen who reads it)
    expect(await audit.verifyChain()).toMatchObject({ ok: true });
  });
});

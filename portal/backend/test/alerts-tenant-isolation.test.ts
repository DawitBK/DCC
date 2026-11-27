import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/platform/database/database';
import { TenantDb } from '../src/platform/tenancy/tenant-db';
import { appUrl, ctx, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

/**
 * Attack tests for the four tables of the alerts area (Round 3): another company's or another group's person can
 * neither read nor write these rows, connecting as the restricted application role; the group-scoped tables
 * (settings, contacts) follow their own rules; and the grants are as small as promised.
 */
describe('alert tables: company and group isolation, and grants', () => {
  let database: Database;
  let tenant: TenantDb;
  let f: Fixture;
  let incidentId: string;
  let groupMemberA: string; // company-level person of company A
  let ctoId: string; // group-level, group 1
  let foreignCto: string; // group-level, group 2
  let deliveryId: string;

  const owner = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
    const c = new pg.Client({ connectionString: ownerUrl() });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    await owner(async (c) => {
      const user = async (name: string) =>
        (
          await c.query(
            `insert into users (idp_subject, email, display_name) values ($1, $2, $1) returning id`,
            [`sub-${name}`, `${name}@example.test`],
          )
        ).rows[0].id as string;
      groupMemberA = await user('member-a');
      ctoId = await user('cto');
      foreignCto = await user('foreign-cto');
      await c.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'company_executive')`,
        [groupMemberA, f.groupId, f.companyA],
      );
      await c.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, null, 'group_cto')`,
        [ctoId, f.groupId],
      );
      await c.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, null, 'group_cto')`,
        [foreignCto, f.group2Id],
      );
      incidentId = (
        await c.query(
          `insert into incidents (company_id, title, severity, opened_by) values ($1, 'Seeded', 'critical', $2) returning id`,
          [f.companyA, groupMemberA],
        )
      ).rows[0].id;
      deliveryId = (
        await c.query(
          `insert into alert_deliveries (company_id, group_id, incident_id, channel, severity, subject, body)
           values ($1, $2, $3, 'teams', 'critical', 'Subject', 'Body') returning id`,
          [f.companyA, f.groupId, incidentId],
        )
      ).rows[0].id;
      await c.query(
        `insert into alert_incident_dispatches (company_id, incident_id, severity_rank) values ($1, $2, 3)`,
        [f.companyA, incidentId],
      );
      await c.query(`insert into alert_settings (group_id, updated_by) values ($1, $2)`, [
        f.groupId,
        ctoId,
      ]);
      await c.query(
        `insert into alert_contacts (group_id, user_id, mobile, updated_by) values ($1, $2, '+251911000001', $2)`,
        [f.groupId, groupMemberA],
      );
    });
    database = createDatabase(appUrl(), 1);
    tenant = new TenantDb(database);
  });
  afterAll(async () => {
    await database.close();
  });

  const asMemberA = () => ctx(groupMemberA, [], [f.companyA]);
  const asMemberB = () => ctx(f.users.creatorB, [], [f.companyB]);
  const asCto = () => ctx(ctoId, [f.groupId], []);
  const asForeign = () => ctx(foreignCto, [f.group2Id], []);

  it('with no tenant context nothing is visible (fails closed)', async () => {
    for (const table of [
      'alert_settings',
      'alert_contacts',
      'alert_deliveries',
      'alert_incident_dispatches',
    ]) {
      const { rows } = await database.pool.query(`select count(*)::int as n from ${table}`);
      expect(rows[0].n, table).toBe(0);
    }
  });

  describe('company tables (deliveries, dispatches)', () => {
    it("company A's person sees the rows; company B's person and the other group see none", async () => {
      const count = (c: ReturnType<typeof ctx>) =>
        tenant.run(c, async (trx) => ({
          deliveries: (await trx.selectFrom('alert_deliveries').selectAll().execute()).length,
          dispatches: (await trx.selectFrom('alert_incident_dispatches').selectAll().execute())
            .length,
        }));
      expect(await count(asMemberA())).toEqual({ deliveries: 1, dispatches: 1 });
      expect(await count(asCto())).toEqual({ deliveries: 1, dispatches: 1 });
      expect(await count(asMemberB())).toEqual({ deliveries: 0, dispatches: 0 });
      expect(await count(asForeign())).toEqual({ deliveries: 0, dispatches: 0 });
    });

    it("another company's person cannot change a delivery (zero rows) or insert one for company A", async () => {
      for (const who of [asMemberB(), asForeign()]) {
        const changed = await tenant.run(who, (trx) =>
          trx
            .updateTable('alert_deliveries')
            .set({ status: 'sent', sent_at: new Date() })
            .where('id', '=', deliveryId)
            .executeTakeFirst(),
        );
        expect(changed.numUpdatedRows).toBe(0n);
        await expect(
          tenant.run(who, (trx) =>
            trx
              .insertInto('alert_deliveries')
              .values({
                company_id: f.companyA,
                group_id: f.groupId,
                incident_id: incidentId,
                channel: 'teams',
                recipient_user_id: null,
                severity: 'critical',
                subject: 'x',
                body: 'y',
              })
              .execute(),
          ),
        ).rejects.toThrow();
        await expect(
          tenant.run(who, (trx) =>
            trx
              .insertInto('alert_incident_dispatches')
              .values({ company_id: f.companyA, incident_id: incidentId, severity_rank: 2 })
              .execute(),
          ),
        ).rejects.toThrow();
      }
      const [row] = await owner(
        async (c) =>
          (await c.query(`select status from alert_deliveries where id = $1`, [deliveryId])).rows,
      );
      expect(row.status).toBe('pending');
    });

    it('a Teams message has no person and every other message has one (the database says so)', async () => {
      await expect(
        owner((c) =>
          c.query(
            `insert into alert_deliveries (company_id, group_id, incident_id, channel, severity, subject, body)
             values ($1, $2, $3, 'sms', 'critical', 's', 'b')`,
            [f.companyA, f.groupId, incidentId],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        owner((c) =>
          c.query(
            `insert into alert_deliveries (company_id, group_id, incident_id, channel, recipient_user_id, severity, subject, body)
             values ($1, $2, $3, 'teams', $4, 'critical', 's', 'b')`,
            [f.companyA, f.groupId, incidentId, ctoId],
          ),
        ),
      ).rejects.toThrow();
    });
  });

  describe('group tables (settings, contacts)', () => {
    it('the group sees its own settings and contacts; the other group sees neither', async () => {
      const count = (c: ReturnType<typeof ctx>) =>
        tenant.run(c, async (trx) => ({
          settings: (await trx.selectFrom('alert_settings').selectAll().execute()).length,
          contacts: (await trx.selectFrom('alert_contacts').selectAll().execute()).length,
        }));
      expect(await count(asCto())).toEqual({ settings: 1, contacts: 1 });
      expect(await count(asMemberA())).toEqual({ settings: 1, contacts: 1 });
      expect(await count(asForeign())).toEqual({ settings: 0, contacts: 0 });
    });

    it("another group's person cannot change, add or remove this group's settings and contacts", async () => {
      const changed = await tenant.run(asForeign(), async (trx) => ({
        settings: await trx
          .updateTable('alert_settings')
          .set({ sms_enabled: false })
          .where('group_id', '=', f.groupId)
          .executeTakeFirst(),
        contact: await trx
          .updateTable('alert_contacts')
          .set({ mobile: '+251900000000' })
          .where('group_id', '=', f.groupId)
          .executeTakeFirst(),
        removed: await trx
          .deleteFrom('alert_contacts')
          .where('group_id', '=', f.groupId)
          .executeTakeFirst(),
      }));
      expect(changed.settings.numUpdatedRows).toBe(0n);
      expect(changed.contact.numUpdatedRows).toBe(0n);
      expect(changed.removed.numDeletedRows).toBe(0n);
      await expect(
        tenant.run(asForeign(), (trx) =>
          trx
            .insertInto('alert_contacts')
            .values({
              group_id: f.groupId,
              user_id: foreignCto,
              mobile: '+251911999999',
              updated_by: foreignCto,
            })
            .execute(),
        ),
      ).rejects.toThrow();
      await expect(
        tenant.run(asForeign(), (trx) =>
          trx
            .insertInto('alert_settings')
            .values({
              group_id: f.groupId,
              sms_enabled: true,
              teams_enabled: true,
              email_enabled: true,
              min_severity: 'high',
              updated_by: foreignCto,
            })
            .execute(),
        ),
      ).rejects.toThrow();
      const [row] = await owner(
        async (c) =>
          (await c.query(`select sms_enabled from alert_settings where group_id = $1`, [f.groupId]))
            .rows,
      );
      expect(row.sms_enabled).toBe(true);
    });

    it('a company-level person cannot change the group settings, and keeps only their own contact', async () => {
      const settings = await tenant.run(asMemberA(), (trx) =>
        trx
          .updateTable('alert_settings')
          .set({ sms_enabled: false })
          .where('group_id', '=', f.groupId)
          .executeTakeFirst(),
      );
      expect(settings.numUpdatedRows).toBe(0n);
      // their own contact: allowed
      const own = await tenant.run(asMemberA(), (trx) =>
        trx
          .updateTable('alert_contacts')
          .set({ mobile: '+251911000009' })
          .where('user_id', '=', groupMemberA)
          .executeTakeFirst(),
      );
      expect(own.numUpdatedRows).toBe(1n);
      // someone else's: not allowed (the CTO's row does not exist yet, so insert it as the CTO first)
      await tenant.run(asCto(), (trx) =>
        trx
          .insertInto('alert_contacts')
          .values({
            group_id: f.groupId,
            user_id: ctoId,
            mobile: '+251911000002',
            updated_by: ctoId,
          })
          .execute(),
      );
      const others = await tenant.run(asMemberA(), async (trx) => ({
        update: await trx
          .updateTable('alert_contacts')
          .set({ mobile: '+251900000001' })
          .where('user_id', '=', ctoId)
          .executeTakeFirst(),
        remove: await trx
          .deleteFrom('alert_contacts')
          .where('user_id', '=', ctoId)
          .executeTakeFirst(),
      }));
      expect(others.update.numUpdatedRows).toBe(0n);
      expect(others.remove.numDeletedRows).toBe(0n);
      await expect(
        tenant.run(asMemberA(), (trx) =>
          trx
            .insertInto('alert_contacts')
            .values({
              group_id: f.groupId,
              user_id: f.users.groupAdmin,
              mobile: '+251911888888',
              updated_by: groupMemberA,
            })
            .execute(),
        ),
      ).rejects.toThrow();
      // a company-level person of company B (same group) cannot reach A's data either, but may keep their own number
      await tenant.run(asMemberB(), (trx) =>
        trx
          .insertInto('alert_contacts')
          .values({
            group_id: f.groupId,
            user_id: f.users.creatorB,
            mobile: '+251911777777',
            updated_by: f.users.creatorB,
          })
          .execute(),
      );
    });

    // The stored value is sealed text since 2026-11-27, so the database can only refuse an empty or absurd value; the international
    // form is checked by the API (alerts.e2e.test.ts: "refuses numbers that are not in international form").
    it('the database refuses an empty or absurdly short or long value', async () => {
      for (const mobile of ['', 'abc', 'x'.repeat(2001)])
        await expect(
          owner((c) =>
            c.query(
              `insert into alert_contacts (group_id, user_id, mobile, updated_by) values ($1, $2, $3, $2)`,
              [f.groupId, f.users.adminA, mobile],
            ),
          ),
          mobile,
        ).rejects.toThrow();
    });
  });

  describe('grants', () => {
    it('the application role cannot delete deliveries or dispatches, nor edit a dispatch', async () => {
      await expect(
        tenant.run(asCto(), (trx) => trx.deleteFrom('alert_deliveries').execute()),
      ).rejects.toThrow(/permission denied/);
      await expect(
        tenant.run(asCto(), (trx) => trx.deleteFrom('alert_incident_dispatches').execute()),
      ).rejects.toThrow(/permission denied/);
      await expect(
        tenant.run(asCto(), (trx) =>
          trx.updateTable('alert_incident_dispatches').set({ severity_rank: 2 }).execute(),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        tenant.run(asCto(), (trx) => trx.deleteFrom('alert_settings').execute()),
      ).rejects.toThrow(/permission denied/);
    });

    it('the attempts counter cannot go past five', async () => {
      await expect(
        owner((c) =>
          c.query(`update alert_deliveries set attempts = 6 where id = $1`, [deliveryId]),
        ),
      ).rejects.toThrow();
    });
  });

  describe('alert_recipients()', () => {
    const recipients = (
      c: ReturnType<typeof ctx>,
      company: string,
      roles: string[],
      ids: string[] = [],
    ) =>
      tenant.run(c, async (trx) => {
        const { rows } = await sql<{
          user_id: string;
        }>`select user_id from alert_recipients(${company}::uuid, ${sql.val(roles)}::text[], ${sql.val(ids)}::uuid[])`.execute(
          trx,
        );
        return rows.map((r) => r.user_id).sort();
      });

    it('finds the people of the company and of its group, by role or by id', async () => {
      expect(await recipients(asMemberA(), f.companyA, ['company_executive', 'group_cto'])).toEqual(
        [groupMemberA, ctoId].sort(),
      );
      expect(await recipients(asMemberA(), f.companyA, [], [ctoId])).toEqual([ctoId]);
    });

    it('answers nothing to a caller who may not touch that company', async () => {
      expect(await recipients(asMemberB(), f.companyA, ['company_executive', 'group_cto'])).toEqual(
        [],
      );
      expect(await recipients(asForeign(), f.companyA, ['company_executive', 'group_cto'])).toEqual(
        [],
      );
    });

    it("never returns another group's people, nor a person who does not belong, whatever ids are asked for", async () => {
      expect(await recipients(asCto(), f.companyA, ['group_cto'])).toEqual([ctoId]);
      expect(await recipients(asCto(), f.companyA, [], [foreignCto, f.users.creatorB])).toEqual([]);
    });

    it('skips a disabled person', async () => {
      await owner((c) => c.query(`update users set status = 'disabled' where id = $1`, [ctoId]));
      try {
        expect(await recipients(asMemberA(), f.companyA, ['group_cto'])).toEqual([]);
      } finally {
        await owner((c) => c.query(`update users set status = 'active' where id = $1`, [ctoId]));
      }
    });
  });
});

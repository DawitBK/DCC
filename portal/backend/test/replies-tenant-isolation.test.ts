import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/platform/database/database';
import { TenantDb } from '../src/platform/tenancy/tenant-db';
import { appUrl, ctx, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

/**
 * Attack tests for the five tables of the "replies" area (Round 2): a person of company B can neither read nor write
 * company A's rows, connecting as the restricted application role; and the grants are as small as promised.
 */
describe('replies tables: company isolation and grants', () => {
  let database: Database;
  let tenant: TenantDb;
  let f: Fixture;
  let requestId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    try {
      await owner.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'company_marketing_manager')`,
        [f.users.adminA, f.groupId, f.companyA],
      );
      requestId = (
        await owner.query(
          `insert into reply_approval_requests (company_id, social_account_id, engine_message_id, kind, text, written_by, due_at, category_key)
           values ($1, $2, 'm1', 'media', 'Text', $3, now(), 'crisis') returning id`,
          [f.companyA, f.accountA, f.users.adminA],
        )
      ).rows[0].id;
      await owner.query(
        `insert into reply_approval_decisions (request_id, company_id, decided_by, decision) values ($1, $2, $3, 'approved')`,
        [requestId, f.companyA, f.users.adminA],
      );
      await owner.query(
        `insert into inbox_moderation_actions (company_id, social_account_id, engine_message_id, action, reason, outcome, performed_by)
         values ($1, $2, 'm1', 'delete', 'Abusive language', 'done', $3)`,
        [f.companyA, f.accountA, f.users.adminA],
      );
      await owner.query(
        `insert into inbox_ack_settings (company_id, text_en, set_by) values ($1, 'Hello', $2)`,
        [f.companyA, f.users.adminA],
      );
      await owner.query(
        `insert into inbox_acknowledgements (company_id, social_account_id, engine_message_id, received_at, language)
         values ($1, $2, 'm1', now(), 'en')`,
        [f.companyA, f.accountA],
      );
    } finally {
      await owner.end();
    }
    database = createDatabase(appUrl(), 1);
    tenant = new TenantDb(database);
  });
  afterAll(async () => {
    await database.close();
  });

  const TABLES = [
    'reply_approval_requests',
    'reply_approval_decisions',
    'inbox_moderation_actions',
    'inbox_ack_settings',
    'inbox_acknowledgements',
  ] as const;

  it('with no tenant context nothing is visible (fails closed)', async () => {
    for (const table of TABLES) {
      const { rows } = await database.pool.query(`select count(*)::int as n from ${table}`);
      expect(rows[0].n, table).toBe(0);
    }
  });

  it("company A's person sees their rows; company B's person sees none of them", async () => {
    const asA = await tenant.run(ctx(f.users.adminA, [], [f.companyA]), async (trx) => {
      const out: Record<string, number> = {};
      for (const table of TABLES)
        out[table] = (await trx.selectFrom(table).selectAll().execute()).length;
      return out;
    });
    for (const table of TABLES) expect(asA[table], table).toBe(1);
    const asB = await tenant.run(ctx(f.users.creatorB, [], [f.companyB]), async (trx) => {
      const out: Record<string, number> = {};
      for (const table of TABLES)
        out[table] = (await trx.selectFrom(table).selectAll().execute()).length;
      return out;
    });
    for (const table of TABLES) expect(asB[table], table).toBe(0);
  });

  it("company B's person cannot update company A's rows (zero rows change)", async () => {
    const asB = ctx(f.users.creatorB, [], [f.companyB]);
    const changed = await tenant.run(asB, async (trx) => ({
      request: await trx
        .updateTable('reply_approval_requests')
        .set({ status: 'rejected', settled_at: new Date() })
        .where('id', '=', requestId)
        .executeTakeFirst(),
      ack: await trx
        .updateTable('inbox_acknowledgements')
        .set({ acked_at: new Date() })
        .where('company_id', '=', f.companyA)
        .executeTakeFirst(),
      settings: await trx
        .updateTable('inbox_ack_settings')
        .set({ text_en: 'Hijacked' })
        .where('company_id', '=', f.companyA)
        .executeTakeFirst(),
    }));
    expect(changed.request.numUpdatedRows).toBe(0n);
    expect(changed.ack.numUpdatedRows).toBe(0n);
    expect(changed.settings.numUpdatedRows).toBe(0n);
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    try {
      expect(
        (await owner.query(`select status from reply_approval_requests where id = $1`, [requestId]))
          .rows[0].status,
      ).toBe('pending');
    } finally {
      await owner.end();
    }
  });

  it("company B's person cannot insert rows for company A, nor delete an acknowledgement claim of A", async () => {
    const asB = ctx(f.users.creatorB, [], [f.companyB]);
    await expect(
      tenant.run(asB, (trx) =>
        trx
          .insertInto('inbox_moderation_actions')
          .values({
            company_id: f.companyA,
            social_account_id: f.accountA,
            engine_message_id: 'x',
            action: 'hide',
            reason: null,
            outcome: 'done',
            outcome_detail: null,
            performed_by: f.users.creatorB,
          })
          .execute(),
      ),
    ).rejects.toThrow();
    await expect(
      tenant.run(asB, (trx) =>
        trx
          .insertInto('reply_approval_requests')
          .values({
            company_id: f.companyA,
            social_account_id: f.accountA,
            engine_message_id: 'x',
            kind: 'media',
            text: 'Hi',
            written_by: f.users.creatorB,
            required_approvals: 1,
            category_key: 'crisis',
            due_at: new Date(),
            settled_at: null,
            settled_reason: null,
          })
          .execute(),
      ),
    ).rejects.toThrow();
    const deleted = await tenant.run(asB, (trx) =>
      trx
        .deleteFrom('inbox_acknowledgements')
        .where('company_id', '=', f.companyA)
        .executeTakeFirst(),
    );
    expect(deleted.numDeletedRows).toBe(0n);
  });

  it('an acknowledgement that was sent cannot be deleted, even by its own company (only an unsent claim can)', async () => {
    const asA = ctx(f.users.adminA, [], [f.companyA]);
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    try {
      await owner.query(
        `update inbox_acknowledgements set acked_at = now() where company_id = $1`,
        [f.companyA],
      );
      const sent = await tenant.run(asA, (trx) =>
        trx
          .deleteFrom('inbox_acknowledgements')
          .where('company_id', '=', f.companyA)
          .executeTakeFirst(),
      );
      expect(sent.numDeletedRows).toBe(0n);
      await owner.query(`update inbox_acknowledgements set acked_at = null where company_id = $1`, [
        f.companyA,
      ]);
      const claim = await tenant.run(asA, (trx) =>
        trx
          .deleteFrom('inbox_acknowledgements')
          .where('company_id', '=', f.companyA)
          .executeTakeFirst(),
      );
      expect(claim.numDeletedRows).toBe(1n);
    } finally {
      await owner.end();
    }
  });

  it('the application role cannot delete requests, decisions, moderation records or settings', async () => {
    for (const table of [
      'reply_approval_requests',
      'reply_approval_decisions',
      'inbox_moderation_actions',
      'inbox_ack_settings',
    ])
      await expect(database.pool.query(`delete from ${table}`), table).rejects.toThrow(
        /permission denied/,
      );
    await expect(
      database.pool.query(`update reply_approval_decisions set decision = 'rejected'`),
    ).rejects.toThrow(/permission denied/);
  });
});

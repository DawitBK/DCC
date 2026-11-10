import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDatabase, type Database } from '../src/platform/database/database';
import { TenantDb } from '../src/platform/tenancy/tenant-db';
import { appUrl, ctx, resetTestDatabase, seedFixture, type Fixture } from './helpers';

/**
 * These tests try to BREAK tenant isolation against a real PostgreSQL, connecting as the same
 * restricted role the API uses (dcc_app). If one of them fails, treat it as a security defect.
 */
describe('tenant isolation (PostgreSQL RLS)', () => {
  let database: Database;
  let tenant: TenantDb;
  let f: Fixture;

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    // max: 1 forces EVERY query through the same physical connection: the worst case for context leakage.
    database = createDatabase(appUrl(), 1);
    tenant = new TenantDb(database);
  });
  afterAll(async () => {
    await database.close();
  });

  it('the runtime role is not a superuser, cannot bypass RLS, and owns nothing', async () => {
    const { rows } = await database.pool.query(
      `select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user`,
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    const owned = await database.pool.query(
      `select count(*)::int as n from pg_tables where schemaname = 'public' and tableowner = current_user`,
    );
    expect(owned.rows[0].n).toBe(0);
  });

  it('with no tenant context nothing is visible (fails closed)', async () => {
    for (const table of [
      'groups',
      'companies',
      'brands',
      'social_accounts',
      'memberships',
      'users',
      'audit_events',
      'account_assignments',
    ]) {
      const { rows } = await database.pool.query(`select count(*)::int as n from ${table}`);
      expect(rows[0].n, table).toBe(0);
    }
  });

  it('a company-level user sees their own company and nothing of another company', async () => {
    const rows = await tenant.run(ctx(f.users.adminA, [], [f.companyA]), async (trx) => ({
      companies: await trx.selectFrom('companies').select('name').execute(),
      brands: await trx.selectFrom('brands').select('name').execute(),
      accounts: await trx.selectFrom('social_accounts').select('display_name').execute(),
    }));
    expect(rows.companies.map((c) => c.name)).toEqual(['Company A']);
    expect(rows.brands.map((b) => b.name)).toEqual(['Brand A']);
    expect(rows.accounts.map((a) => a.display_name)).toEqual(['A page']);
  });

  it('a company id supplied by the caller does not widen access: asking for company B by id returns nothing', async () => {
    const found = await tenant.run(ctx(f.users.adminA, [], [f.companyA]), (trx) =>
      trx.selectFrom('brands').selectAll().where('company_id', '=', f.companyB).execute(),
    );
    expect(found).toEqual([]);
  });

  it('cannot WRITE into another company (insert is blocked by the policy)', async () => {
    await expect(
      tenant.run(ctx(f.users.adminA, [], [f.companyA]), (trx) =>
        trx
          .insertInto('brands')
          .values({ company_id: f.companyB, name: 'Injected', slug: 'injected' })
          .execute(),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot UPDATE another company (zero rows match)', async () => {
    const result = await tenant.run(ctx(f.users.adminA, [], [f.companyA]), (trx) =>
      trx
        .updateTable('companies')
        .set({ name: 'Hacked' })
        .where('id', '=', f.companyB)
        .executeTakeFirst(),
    );
    expect(Number(result.numUpdatedRows)).toBe(0);
  });

  it('cannot move an own row to another company (WITH CHECK)', async () => {
    await expect(
      tenant.run(ctx(f.users.adminA, [], [f.companyA]), (trx) =>
        sql`update social_accounts set company_id = ${f.companyB} where id = ${f.accountA}`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow();
  });

  it('a group-level administrator sees every company of THEIR group, but not another group', async () => {
    const names = await tenant.run(ctx(f.users.groupAdmin, [f.groupId], []), async (trx) =>
      (await trx.selectFrom('companies').select('name').orderBy('name').execute()).map(
        (c) => c.name,
      ),
    );
    expect(names).toEqual(['Company A', 'Company B']);
    const brands = await tenant.run(ctx(f.users.groupAdmin, [f.groupId], []), (trx) =>
      trx.selectFrom('brands').select('name').execute(),
    );
    expect(brands).toHaveLength(2);
  });

  it('a group administrator of group 1 cannot create a company in group 2', async () => {
    await expect(
      tenant.run(ctx(f.users.groupAdmin, [f.groupId], []), (trx) =>
        trx
          .insertInto('companies')
          .values({ group_id: f.group2Id, name: 'Rogue', slug: 'rogue', updated_at: new Date() })
          .execute(),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('people are visible only inside a scope the viewer manages', async () => {
    const emails = await tenant.run(ctx(f.users.adminA, [], [f.companyA]), async (trx) =>
      (await trx.selectFrom('users').select('email').orderBy('email').execute()).map(
        (u) => u.email,
      ),
    );
    // adminA sees themself and the other members of company A; never creator-b (company B only) or outsiders.
    expect(emails).toEqual(['admin-a@example.test', 'auditor-a@example.test']);
  });

  it('a company administrator cannot grant a group-level role, nor a role in another company', async () => {
    await expect(
      tenant.run(ctx(f.users.adminA, [], [f.companyA]), (trx) =>
        trx
          .insertInto('memberships')
          .values({
            user_id: f.users.outsider,
            group_id: f.groupId,
            company_id: null,
            role: 'group_admin',
          })
          .execute(),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      tenant.run(ctx(f.users.adminA, [], [f.companyA]), (trx) =>
        trx
          .insertInto('memberships')
          .values({
            user_id: f.users.outsider,
            group_id: f.groupId,
            company_id: f.companyB,
            role: 'publisher',
          })
          .execute(),
      ),
    ).rejects.toThrow(/row-level security/i);
    // ...but can grant a company role inside their own company.
    await tenant.run(ctx(f.users.adminA, [], [f.companyA]), (trx) =>
      trx
        .insertInto('memberships')
        .values({
          user_id: f.users.outsider,
          group_id: f.groupId,
          company_id: f.companyA,
          role: 'publisher',
        })
        .execute(),
    );
  });

  it('the schema itself refuses a group-only role at company scope', async () => {
    await expect(
      tenant.run(ctx(f.users.groupAdmin, [f.groupId], []), (trx) =>
        trx
          .insertInto('memberships')
          .values({
            user_id: f.users.outsider,
            group_id: f.groupId,
            company_id: f.companyA,
            role: 'group_admin',
          })
          .execute(),
      ),
    ).rejects.toThrow(/membership_role_scope/);
  });

  it('context does not leak between requests on the same pooled connection', async () => {
    await tenant.run(ctx(f.users.adminA, [], [f.companyA]), async (trx) => {
      const { rows } = await sql<{ n: number }>`select count(*)::int as n from companies`.execute(
        trx,
      );
      expect(rows[0]!.n).toBe(1);
    });
    // Same single connection, next "request" with no context at all:
    const after = await database.pool.query(`select count(*)::int as n from companies`);
    expect(after.rows[0].n).toBe(0);
    const setting = await database.pool.query(
      `select current_setting('app.company_ids', true) as v`,
    );
    expect(setting.rows[0].v ?? '').toBe('');
  });

  it('context is discarded even when the work throws', async () => {
    await expect(
      tenant.run(ctx(f.users.groupAdmin, [f.groupId], []), async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const after = await database.pool.query(`select count(*)::int as n from companies`);
    expect(after.rows[0].n).toBe(0);
  });

  it('refuses to set a context built from non-UUID values (no injection through ids)', () => {
    expect(() =>
      tenant.run(
        ctx(f.users.adminA, [], [`${f.companyA}', true); drop table companies; --`]),
        async () => 1,
      ),
    ).toThrow(/non-UUID/);
  });
});

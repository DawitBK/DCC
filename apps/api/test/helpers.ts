import { resolve } from 'node:path';
import pg from 'pg';
import { migrate } from '../src/platform/database/migrate';

export const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

export const ownerUrl = () => process.env.DCC_MIGRATE_DATABASE_URL!;
export const appUrl = () => process.env.DCC_DATABASE_URL!;

/** Drops everything in the scratch test database and re-applies the real migrations. Refuses any database not named like a test one. */
export async function resetTestDatabase(): Promise<void> {
  if (!/\/dcc_test(\?|$)/.test(ownerUrl()))
    throw new Error('Refusing to reset a database that is not dcc_test');
  const owner = new pg.Client({ connectionString: ownerUrl() });
  await owner.connect();
  try {
    await owner.query('drop schema public cascade');
    await owner.query('create schema public');
    await owner.query('grant usage on schema public to dcc_app');
  } finally {
    await owner.end();
  }
  await migrate(ownerUrl(), MIGRATIONS_DIR);
}

export interface Fixture {
  groupId: string;
  group2Id: string;
  companyA: string;
  companyB: string;
  company2: string; // belongs to the OTHER group
  brandA: string;
  brandB: string;
  accountA: string;
  accountB: string;
  users: Record<
    'groupAdmin' | 'adminA' | 'creatorB' | 'auditorA' | 'outsider' | 'otherGroupAdmin',
    string
  >;
}

/** Inserts a small, fictional world as the OWNER (who bypasses RLS) so tests start from known rows. */
export async function seedFixture(): Promise<Fixture> {
  const c = new pg.Client({ connectionString: ownerUrl() });
  await c.connect();
  try {
    const one = async (text: string, values: unknown[] = []) =>
      (await c.query(text, values)).rows[0].id as string;
    const groupId = await one(
      `insert into groups (name, slug) values ('Test Group', 'test-group') returning id`,
    );
    const group2Id = await one(
      `insert into groups (name, slug) values ('Other Group', 'other-group') returning id`,
    );
    const companyA = await one(
      `insert into companies (group_id, name, slug) values ($1, 'Company A', 'a') returning id`,
      [groupId],
    );
    const companyB = await one(
      `insert into companies (group_id, name, slug) values ($1, 'Company B', 'b') returning id`,
      [groupId],
    );
    const company2 = await one(
      `insert into companies (group_id, name, slug) values ($1, 'Company Two', 'two') returning id`,
      [group2Id],
    );
    const brandA = await one(
      `insert into brands (company_id, name, slug) values ($1, 'Brand A', 'brand-a') returning id`,
      [companyA],
    );
    const brandB = await one(
      `insert into brands (company_id, name, slug) values ($1, 'Brand B', 'brand-b') returning id`,
      [companyB],
    );
    const accountA = await one(
      `insert into social_accounts (company_id, brand_id, platform, display_name, handle) values ($1, $2, 'linkedin', 'A page', '@a') returning id`,
      [companyA, brandA],
    );
    const accountB = await one(
      `insert into social_accounts (company_id, brand_id, platform, display_name, handle) values ($1, $2, 'facebook', 'B page', '@b') returning id`,
      [companyB, brandB],
    );
    const user = (n: string) =>
      one(`insert into users (idp_subject, email, display_name) values ($1, $2, $1) returning id`, [
        `sub-${n}`,
        `${n}@example.test`,
      ]);
    const users = {
      groupAdmin: await user('group-admin'),
      adminA: await user('admin-a'),
      creatorB: await user('creator-b'),
      auditorA: await user('auditor-a'),
      outsider: await user('outsider'),
      otherGroupAdmin: await user('other-group-admin'),
    };
    const member = (u: string, g: string, co: string | null, role: string) =>
      c.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`,
        [u, g, co, role],
      );
    await member(users.groupAdmin, groupId, null, 'group_admin');
    await member(users.adminA, groupId, companyA, 'company_admin');
    await member(users.creatorB, groupId, companyB, 'content_creator');
    await member(users.auditorA, groupId, companyA, 'auditor');
    await member(users.otherGroupAdmin, group2Id, null, 'group_admin');
    return {
      groupId,
      group2Id,
      companyA,
      companyB,
      company2,
      brandA,
      brandB,
      accountA,
      accountB,
      users,
    };
  } finally {
    await c.end();
  }
}

/** The tenant context a request for this person would get (what AccessService resolves in production). */
export const ctx = (userId: string, groupIds: string[] = [], companyIds: string[] = []) => ({
  userId,
  groupIds,
  companyIds,
});

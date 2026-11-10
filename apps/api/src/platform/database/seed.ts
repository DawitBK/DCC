import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));

/**
 * Safe DEVELOPMENT seed. It creates the group and clearly fictional demo companies ("Demo Company A/B/C",
 * the placeholders used in the proposal's mock-up). It contains NO real subsidiary, brand, account or
 * employee data: that comes from the onboarding process (docs/onboarding/), never from a seed.
 * Runs as the owner role (the runtime role cannot insert groups).
 */
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed in production.');
  process.exit(1);
}
const url = process.env.DCC_MIGRATE_DATABASE_URL;
if (!url) {
  console.error('Missing DCC_MIGRATE_DATABASE_URL. Copy .env.example to .env.');
  process.exit(1);
}

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const slug = process.env.DCC_DEFAULT_GROUP_SLUG ?? 'kerchanshe';
    const group = await client.query<{ id: string }>(
      `insert into groups (name, slug) values ('Kerchanshe Group', $1)
       on conflict (slug) do update set name = excluded.name returning id`,
      [slug],
    );
    const groupId = group.rows[0]!.id;
    for (const [name, companySlug] of [
      ['Demo Company A', 'demo-company-a'],
      ['Demo Company B', 'demo-company-b'],
      ['Demo Company C', 'demo-company-c'],
    ] as const) {
      const company = await client.query<{ id: string }>(
        `insert into companies (group_id, name, slug) values ($1, $2, $3)
         on conflict (group_id, slug) do update set name = excluded.name returning id`,
        [groupId, name, companySlug],
      );
      const brand = await client.query<{ id: string }>(
        `insert into brands (company_id, name, slug) values ($1, $2, 'demo-brand')
         on conflict (company_id, slug) do update set name = excluded.name returning id`,
        [company.rows[0]!.id, `${name} brand`],
      );
      await client.query(
        `insert into social_accounts (company_id, brand_id, platform, display_name, handle, status)
         values ($1, $2, 'linkedin', $3, $4, 'active') on conflict (company_id, platform, handle) do nothing`,
        [company.rows[0]!.id, brand.rows[0]!.id, `${name} (demo account)`, `@${companySlug}`],
      );
    }
    console.log(`seed: group "${slug}" with 3 demo companies ready`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

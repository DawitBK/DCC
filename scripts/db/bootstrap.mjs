// Creates the two database roles and the dev/test databases. Idempotent. Needs a superuser URL.
//
//   dcc_owner : owns the schema, runs migrations. NOT used by the running API.
//   dcc_app   : what the API connects as. No superuser, no BYPASSRLS, cannot create anything.
//
// Usage: node scripts/db/bootstrap.mjs [--reset]     (--reset drops and recreates the databases)
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));

const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
};

const adminUrl = need('DCC_ADMIN_DATABASE_URL');
const ownerPassword = need('DCC_OWNER_PASSWORD');
const appPassword = need('DCC_APP_PASSWORD');
const databases = [
  process.env.DCC_DB_NAME ?? 'dcc_dev',
  process.env.DCC_TEST_DB_NAME ?? 'dcc_test',
];
const reset = process.argv.includes('--reset');

if (/prod/i.test(adminUrl) || process.env.NODE_ENV === 'production') {
  console.error('Refusing to run the bootstrap against anything that looks like production.');
  process.exit(1);
}

const ident = (s) => '"' + s.replaceAll('"', '""') + '"';

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();

async function ensureRole(name, password) {
  const exists =
    (await admin.query('select 1 from pg_roles where rolname = $1', [name])).rowCount > 0;
  const attrs = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION';
  const pw = admin.escapeLiteral(password);
  await admin.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${ident(name)} ${attrs} PASSWORD ${pw}`);
}

await ensureRole('dcc_owner', ownerPassword);
await ensureRole('dcc_app', appPassword);

for (const db of databases) {
  if (!/^[a-z][a-z0-9_]*$/.test(db)) throw new Error(`Bad database name: ${db}`);
  if (reset) await admin.query(`DROP DATABASE IF EXISTS ${ident(db)} WITH (FORCE)`);
  const exists =
    (await admin.query('select 1 from pg_database where datname = $1', [db])).rowCount > 0;
  if (!exists) await admin.query(`CREATE DATABASE ${ident(db)} OWNER dcc_owner`);
  await admin.query(`REVOKE ALL ON DATABASE ${ident(db)} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${ident(db)} TO dcc_app, dcc_owner`);

  const inDb = new pg.Client({ connectionString: adminUrl, database: db });
  await inDb.connect();
  await inDb.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await inDb.query('GRANT USAGE ON SCHEMA public TO dcc_app');
  await inDb.query('GRANT ALL ON SCHEMA public TO dcc_owner');
  await inDb.end();
  console.log(`database ${db}: ready`);
}

await admin.end();
console.log('roles dcc_owner and dcc_app: ready');

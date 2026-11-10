// Restores a dump INTO A NAMED, EMPTY DATABASE. It never overwrites the live database by itself.
//   node scripts/db/restore.mjs <dumpFile> <targetDatabase> --execute
// Without --execute it only prints what it would do (dry run). Rehearse restores into a scratch
// database (e.g. dcc_restore_check) and verify with: select * from audit_verify();
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const root = resolve(import.meta.dirname, '..', '..');
if (!process.env.DCC_ENV_FILE && existsSync(resolve(root, '.env')))
  process.loadEnvFile(resolve(root, '.env'));

const [dump, target] = process.argv.slice(2);
const execute = process.argv.includes('--execute');
if (!dump || !target || !/^[a-z][a-z0-9_]*$/.test(target)) {
  console.error('Usage: restore.mjs <dumpFile> <targetDatabase> [--execute]');
  process.exit(1);
}
if (!existsSync(dump)) {
  console.error(`No such file: ${dump}`);
  process.exit(1);
}
if (target === (process.env.DCC_DB_NAME ?? 'dcc_dev') && !process.env.DCC_RESTORE_OVER_LIVE) {
  console.error(
    `"${target}" is the configured live database. Restore into a scratch name first, or set DCC_RESTORE_OVER_LIVE=yes deliberately.`,
  );
  process.exit(1);
}

const admin = process.env.DCC_ADMIN_DATABASE_URL;
if (!admin) {
  console.error(
    'Missing DCC_ADMIN_DATABASE_URL (a superuser, used to create the empty target database).',
  );
  process.exit(1);
}
console.log(`${execute ? 'RESTORING' : 'DRY RUN: would restore'} ${dump} -> database "${target}"`);
if (!execute) process.exit(0);

const client = new pg.Client({ connectionString: admin });
await client.connect();
const exists =
  (await client.query('select 1 from pg_database where datname = $1', [target])).rowCount > 0;
if (!exists) await client.query(`create database "${target}" owner dcc_owner`);
await client.end();

const targetUrl = new URL(process.env.DCC_MIGRATE_DATABASE_URL);
targetUrl.pathname = `/${target}`;
const run = spawnSync(
  'pg_restore',
  ['--no-owner', '--role=dcc_owner', `--dbname=${targetUrl.toString()}`, dump],
  { stdio: 'inherit', windowsHide: true },
);
if (run.status !== 0) process.exit(run.status ?? 1);
console.log(
  'restore finished. Next: verify the audit chain and row counts (docs/devops/BACKUP-AND-RECOVERY.md).',
);

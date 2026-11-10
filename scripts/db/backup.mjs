// Backs up the DCC database to a custom-format dump. Needs pg_dump on PATH (it ships with PostgreSQL).
//   node scripts/db/backup.mjs [outputDir]      (default: ./backups, git-ignored)
// Uses the OWNER role so every table and the audit chain are included. Procedure: docs/devops/BACKUP-AND-RECOVERY.md
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));

const url = process.env.DCC_MIGRATE_DATABASE_URL;
if (!url) {
  console.error('Missing DCC_MIGRATE_DATABASE_URL');
  process.exit(1);
}
const dir = resolve(process.argv[2] ?? resolve(root, 'backups'));
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = resolve(dir, `dcc-${stamp}.dump`);

const run = spawnSync('pg_dump', ['--format=custom', '--no-owner', `--file=${file}`, url], {
  stdio: 'inherit',
  windowsHide: true,
});
if (run.status !== 0) {
  console.error('pg_dump failed (is it installed and on PATH?)');
  process.exit(run.status ?? 1);
}
console.log(`backup written: ${file}`);
console.log(
  'Remember: a backup contains personal data and the audit trail. Store it like production data.',
);

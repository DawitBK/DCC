// Backs up the DCC database to a custom-format dump, with a manifest beside it.
// Needs pg_dump and psql on PATH (both ship with PostgreSQL).
//   node scripts/db/backup.mjs [outputDir]      (default: ./backups, git-ignored)
// Uses the OWNER role so every table and the audit chain are included. Procedure: docs/devops/BACKUP-AND-RECOVERY.md
//
// The manifest (decision D-06) records the size and SHA-256 of the dump and the audit chain head at the moment of
// the backup. After a restore, the restored database must show the same head: see BACKUP-AND-RECOVERY.md.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
if (!process.env.DCC_ENV_FILE && existsSync(resolve(root, '.env')))
  process.loadEnvFile(resolve(root, '.env'));

const url = process.env.DCC_MIGRATE_DATABASE_URL;
if (!url) {
  console.error('Missing DCC_MIGRATE_DATABASE_URL');
  process.exit(1);
}
const dir = resolve(process.argv[2] ?? resolve(root, 'backups'));
mkdirSync(dir, { recursive: true });
const takenAt = new Date();
const stamp = takenAt.toISOString().replace(/[:.]/g, '-');
const file = resolve(dir, `dcc-${stamp}.dump`);

// The audit head is read BEFORE the dump: events appended while the dump runs may or may not be in it, so the
// restored database must have AT LEAST this many events and exactly this hash at this event number.
const head = spawnSync(
  'psql',
  [
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--field-separator=|',
    '--command=select last_id, last_hash, events from audit_head()',
    url,
  ],
  { encoding: 'utf8', windowsHide: true },
);
let audit = null;
if (head.status === 0) {
  const [lastId, lastHash, events] = head.stdout.trim().split('|');
  audit = { lastId: Number(lastId), lastHash, events: Number(events) };
} else {
  console.warn(
    'WARNING: could not read the audit chain head (is psql on PATH, are migrations applied?). The manifest will not carry it.',
  );
}

const run = spawnSync('pg_dump', ['--format=custom', '--no-owner', `--file=${file}`, url], {
  stdio: 'inherit',
  windowsHide: true,
});
if (run.status !== 0) {
  console.error('pg_dump failed (is it installed and on PATH?)');
  process.exit(run.status ?? 1);
}

const sha256 = await new Promise((done, fail) => {
  const hash = createHash('sha256');
  createReadStream(file)
    .on('data', (chunk) => hash.update(chunk))
    .on('end', () => done(hash.digest('hex')))
    .on('error', fail);
});
const manifest = {
  v: 1,
  file: basename(file),
  takenAt: takenAt.toISOString(),
  bytes: statSync(file).size,
  sha256,
  audit,
};
const manifestFile = `${file}.manifest.json`;
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`backup written:   ${file}`);
console.log(`manifest written: ${manifestFile}`);
if (audit)
  console.log(`audit chain head: event ${audit.lastId} of ${audit.events} (in the manifest)`);
console.log(
  'Remember: a backup contains personal data and the audit trail. Store it like production data.',
);

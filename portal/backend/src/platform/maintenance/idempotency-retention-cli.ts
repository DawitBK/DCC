import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { parseDays, pruneIdempotencyKeys, RetentionInputError } from './idempotency-retention';

/**
 * The retention command for idempotency keys (H-15). Run from the repository root:
 *   npm run idempotency:prune -- --older-than-days 90            dry run: counts only, changes nothing
 *   npm run idempotency:prune -- --older-than-days 90 --apply    removes the eligible keys, records it in the audit trail
 * On a server (built code): node portal/backend/dist/platform/maintenance/idempotency-retention-cli.js ...
 * Read docs/devops/IDEMPOTENCY-RETENTION.md first. Uses the normal runtime role (DCC_DATABASE_URL).
 */
const root = resolve(__dirname, '..', '..', '..', '..', '..');
if (!process.env.DCC_ENV_FILE && existsSync(resolve(root, '.env')))
  process.loadEnvFile(resolve(root, '.env'));

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const unknownFlags = args.filter(
    (a, i) =>
      a.startsWith('--') &&
      a !== '--apply' &&
      a !== '--older-than-days' &&
      args[i - 1] !== '--older-than-days',
  );
  if (unknownFlags.length) {
    console.error(`Unknown option: ${unknownFlags.join(' ')}`);
    return 2;
  }
  let days: number;
  try {
    days = parseDays(option(args, '--older-than-days'));
  } catch (error) {
    if (error instanceof RetentionInputError) {
      console.error(error.message);
      console.error('Usage: idempotency:prune --older-than-days <N> [--apply]');
      return 2;
    }
    throw error;
  }
  const apply = args.includes('--apply');
  const url = process.env.DCC_DATABASE_URL;
  if (!url) {
    console.error('Missing DCC_DATABASE_URL. Copy .env.example to .env.');
    return 2;
  }

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const report = await pruneIdempotencyKeys(db, { days, apply });
    console.log(
      `${apply ? 'APPLIED' : 'DRY RUN (nothing changed; add --apply to remove)'}: cutoff ${report.cutoff} (${days} days)`,
    );
    console.log(`  done keys: ${report.doneTotal}`);
    console.log(
      `    eligible (older than the cutoff, no scheduled or pending publication): ${report.eligible}`,
    );
    console.log(`    kept, newer than the cutoff: ${report.keptRecent}`);
    console.log(`    kept, a publication still waits on them: ${report.keptUnsettledPublication}`);
    console.log(`  never touched: in_progress ${report.inProgress}, unknown ${report.unknown}`);
    if (apply) {
      console.log(
        `  removed: ${report.removed}${report.oldestRemoved ? ` (last updated ${report.oldestRemoved} to ${report.newestRemoved})` : ''}`,
      );
      console.log(`  audit event: ${report.auditEventId}`);
    }
    return 0;
  } finally {
    await db.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

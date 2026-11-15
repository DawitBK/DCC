import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { appendCheckpoint, readCheckpoints, takeCheckpoint, verifyCheckpoints } from './checkpoint';

/**
 * The audit checkpoint job (decision D-06, task L-09). Run it from the repository root:
 *   npm run audit:checkpoint -- write     take a checkpoint, append it to the file and to the copy
 *   npm run audit:checkpoint -- verify    compare the checkpoints with the database; exit 1 on any problem
 * On a server (built code): node portal/backend/dist/platform/audit/checkpoint-cli.js write|verify
 *
 * Settings (environment):
 *   DCC_DATABASE_URL                 the normal runtime role is enough (two read-only functions)
 *   DCC_AUDIT_CHECKPOINT_DIR         where the file lives on this machine (default: ./audit-checkpoints)
 *   DCC_AUDIT_CHECKPOINT_COPY_DIR    the SECOND place: a folder the DCC database administrators cannot
 *                                    write to (the Linux host's share, write-once storage). `verify` trusts
 *                                    this copy when it is set.
 *   DCC_AUDIT_CHECKPOINT_KEY         optional sealing key, kept by whoever keeps the copy
 */
const FILE_NAME = 'audit-checkpoints.jsonl';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
if (!process.env.DCC_ENV_FILE && existsSync(resolve(root, '.env')))
  process.loadEnvFile(resolve(root, '.env'));

async function main(): Promise<number> {
  const command = process.argv[2];
  if (command !== 'write' && command !== 'verify') {
    console.error('Usage: checkpoint-cli <write|verify>');
    return 2;
  }
  const url = process.env.DCC_DATABASE_URL;
  if (!url) {
    console.error('Missing DCC_DATABASE_URL. Copy .env.example to .env.');
    return 2;
  }
  const primary = resolve(
    process.env.DCC_AUDIT_CHECKPOINT_DIR || resolve(root, 'audit-checkpoints'),
    FILE_NAME,
  );
  const copyDir = process.env.DCC_AUDIT_CHECKPOINT_COPY_DIR;
  const copy = copyDir ? resolve(copyDir, FILE_NAME) : null;
  const key = process.env.DCC_AUDIT_CHECKPOINT_KEY || undefined;

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    if (command === 'write') {
      // The copy is the trusted history: continue ITS chain, so damage to the local file cannot spread.
      const history = readCheckpoints(copy ?? primary);
      const checkpoint = await takeCheckpoint(db, { previous: history.at(-1), key });
      appendCheckpoint(primary, checkpoint);
      if (copy) appendCheckpoint(copy, checkpoint);
      console.log(
        `audit checkpoint: ${checkpoint.events} events, last event ${checkpoint.lastId}, chain ${checkpoint.chainOk ? 'ok' : 'BROKEN'}`,
      );
      console.log(`written: ${primary}${copy ? ` and ${copy}` : ''}`);
      if (!copy)
        console.warn(
          'WARNING: DCC_AUDIT_CHECKPOINT_COPY_DIR is not set. A checkpoint kept only on this machine does not protect against someone who controls this machine.',
        );
      if (!key)
        console.warn(
          'WARNING: DCC_AUDIT_CHECKPOINT_KEY is not set. The file is protected against accidents only, not against deliberate editing.',
        );
      return checkpoint.chainOk ? 0 : 1;
    }

    const source = copy ?? primary;
    const checkpoints = readCheckpoints(source);
    if (checkpoints.length === 0) {
      console.error(`No checkpoints in ${source}. Run "write" first.`);
      return 1;
    }
    const report = await verifyCheckpoints(db, checkpoints, { key });
    if (report.ok) {
      console.log(`audit checkpoints: ${report.checked} checked against ${source}: all agree.`);
      return 0;
    }
    console.error(`AUDIT CHECKPOINT MISMATCH (${source}). Treat this as a security incident:`);
    for (const problem of report.problems) console.error(`  - ${problem}`);
    return 1;
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

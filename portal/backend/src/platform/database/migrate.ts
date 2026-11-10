import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

const FILE_RE = /^\d{12}__[a-z0-9_]+\.sql$/;

/**
 * Plain-SQL migrations, applied in filename order, each in its own transaction. Run as the OWNER role.
 *
 * Naming: YYYYMMDDHHMM__what_it_does.sql (a timestamp, not a counter, so five developers adding
 * migrations on parallel branches do not collide on "the next number"). Applied files are checksummed:
 * editing a migration that already ran is refused. Fix forward with a new migration.
 */
export async function migrate(
  connectionString: string,
  dir: string,
  log: (m: string) => void = () => {},
): Promise<MigrationResult> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    if (!FILE_RE.test(f))
      throw new Error(`Migration file "${f}" does not match YYYYMMDDHHMM__name.sql`);
  }

  const client = new pg.Client({ connectionString, application_name: 'dcc-migrate' });
  await client.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query(`create table if not exists schema_migrations (
      filename text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    // One migrator at a time (two developers or CI jobs on the same database).
    await client.query('select pg_advisory_lock(7716002)');

    const done = new Map<string, string>(
      (
        await client.query<{ filename: string; checksum: string }>(
          'select filename, checksum from schema_migrations',
        )
      ).rows.map((r) => [r.filename, r.checksum]),
    );

    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = done.get(file);
      if (previous) {
        if (previous !== checksum) {
          throw new Error(
            `Migration ${file} was edited after it was applied. Revert the edit and add a new migration instead.`,
          );
        }
        result.skipped.push(file);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (filename, checksum) values ($1, $2)', [
          file,
          checksum,
        ]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
      result.applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.query('select pg_advisory_unlock(7716002)').catch(() => undefined);
    await client.end();
  }
  return result;
}

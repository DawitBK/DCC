import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './schema';

export const DATABASE = Symbol('DATABASE');

export interface Database {
  readonly pool: pg.Pool;
  readonly db: Kysely<DB>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

// bigint ids (audit_events.id) come back as strings: JS numbers cannot hold every bigint.
pg.types.setTypeParser(20, (v) => v);

export function createDatabase(connectionString: string, max = 10): Database {
  const pool = new pg.Pool({ connectionString, max, application_name: 'dcc-api' });
  // A broken idle connection must not crash the process.
  pool.on('error', (err) => console.error('pg pool error', err.message));
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return {
    pool,
    db,
    async ping() {
      await pool.query('select 1');
    },
    async close() {
      await db.destroy();
    },
  };
}

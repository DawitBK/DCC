import { Inject, Injectable } from '@nestjs/common';
import type { IdempotencyRecord, IdempotencyStore, PublishResult } from '@dcc/engine-client';
import { DATABASE, type Database } from '../../platform/database/database';

/**
 * H-05: the database-backed store GovernedEngine relies on (portal/engine-client/src/governed.ts)
 * to make sure a publish is never sent to the engine twice. No RLS, no TenantDb: the interface
 * carries no company/user context to scope by, same as sessions/auth_transactions.
 */
@Injectable()
export class DbIdempotencyStore implements IdempotencyStore {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async get(key: string): Promise<IdempotencyRecord | undefined> {
    const row = await this.database.db
      .selectFrom('idempotency_keys')
      .select(['state', 'result'])
      .where('key', '=', key)
      .executeTakeFirst();
    if (!row) return undefined;
    if (row.state === 'done')
      return { state: 'done', result: row.result as unknown as PublishResult };
    return { state: row.state };
  }

  /** Atomic: a concurrent duplicate's insert is rejected by the primary key, so only one caller ever begins. */
  async begin(key: string): Promise<boolean> {
    const row = await this.database.db
      .insertInto('idempotency_keys')
      .values({ key, state: 'in_progress' })
      .onConflict((oc) => oc.column('key').doNothing())
      .returning('key')
      .executeTakeFirst();
    return row !== undefined;
  }

  async complete(key: string, result: PublishResult): Promise<void> {
    await this.database.db
      .updateTable('idempotency_keys')
      .set({
        state: 'done',
        result: result as unknown as Record<string, unknown>,
        updated_at: new Date(),
      })
      .where('key', '=', key)
      .execute();
  }

  async release(key: string): Promise<void> {
    await this.database.db.deleteFrom('idempotency_keys').where('key', '=', key).execute();
  }

  async markUnknown(key: string): Promise<void> {
    await this.database.db
      .updateTable('idempotency_keys')
      .set({ state: 'unknown', updated_at: new Date() })
      .where('key', '=', key)
      .execute();
  }
}

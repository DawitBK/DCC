import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DATABASE, type Database } from '../database/database';
import type { DB } from '../database/schema';

/** The resolved, server-side identity of the caller. Built from the database, never from the request body. */
export interface TenantContext {
  userId: string;
  /** Groups where the caller holds a group-level role. */
  groupIds: string[];
  /** Companies where the caller holds a company-level role. */
  companyIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuids(label: string, ids: string[]): void {
  for (const id of ids) {
    if (!UUID.test(id))
      throw new Error(`Refusing to set tenant context: ${label} contains a non-UUID value`);
  }
}

/**
 * THE way application code touches tenant data. Every query on a tenant table must run inside run():
 * it opens a transaction, sets the three transaction-local settings the RLS policies read, runs the
 * work, and ends the transaction, which discards the settings so a pooled connection can never carry
 * one request's identity into the next. See docs/security/TENANCY-AND-RLS.md.
 */
@Injectable()
export class TenantDb {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  run<T>(ctx: TenantContext, work: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    assertUuids('userId', [ctx.userId]);
    assertUuids('groupIds', ctx.groupIds);
    assertUuids('companyIds', ctx.companyIds);
    return this.database.db.transaction().execute(async (trx) => {
      await sql`select
        set_config('app.user_id', ${ctx.userId}, true),
        set_config('app.group_ids', ${ctx.groupIds.join(',')}, true),
        set_config('app.company_ids', ${ctx.companyIds.join(',')}, true)`.execute(trx);
      return work(trx);
    });
  }

  /** Only the caller's own identity is set. Used to read the caller's own memberships (the policies allow exactly that). */
  runAsUser<T>(userId: string, work: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.run({ userId, groupIds: [], companyIds: [] }, work);
  }
}

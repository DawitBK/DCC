/**
 * H-15 (review point O-6): the retention rule for `idempotency_keys`, as a maintenance command.
 * Nothing runs it automatically: an operator does, deliberately (docs/devops/IDEMPOTENCY-RETENTION.md).
 *
 *  - It must be given the number of days (there is no default), at least MIN_DAYS.
 *  - It is a dry run unless `apply` is true.
 *  - It removes only `done` keys older than the cutoff that no publication is still waiting on; never
 *    `in_progress` or `unknown`. The rules live in the database function `idempotency_prune`.
 *  - An applied run writes one audit event (counts, cutoff, a digest of the removed keys) in the same
 *    transaction as the removal.
 */
export const MIN_DAYS = 30;

/** Anything that can run a query: a pg Pool or Client. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface PruneReport {
  cutoff: string;
  applied: boolean;
  /** `done` keys in the table, and how they divide. */
  doneTotal: number;
  eligible: number;
  keptRecent: number;
  keptUnsettledPublication: number;
  /** Never touched, whatever their age. */
  inProgress: number;
  unknown: number;
  removed: number;
  oldestRemoved: string | null;
  newestRemoved: string | null;
  auditEventId: string | null;
}

export class RetentionInputError extends Error {}

/** The number of days, as an operator typed it. Strict: a whole number from MIN_DAYS up. */
export function parseDays(raw: unknown): number {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,5}$/.test(text))
    throw new RetentionInputError('Give the age in whole days, for example --older-than-days 90.');
  const days = Number(text);
  if (days < MIN_DAYS)
    throw new RetentionInputError(
      `The age must be at least ${MIN_DAYS} days: a recent key still protects against a repeated publish.`,
    );
  return days;
}

export const cutoffFor = (days: number, now: Date = new Date()): Date =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string | Date).toISOString();

export async function pruneIdempotencyKeys(
  db: Queryable,
  options: { days: number; apply: boolean; now?: Date },
): Promise<PruneReport> {
  parseDays(String(options.days));
  const cutoff = cutoffFor(options.days, options.now);
  const { rows } = await db.query('select * from idempotency_prune($1::timestamptz, $2::boolean)', [
    cutoff.toISOString(),
    options.apply,
  ]);
  const r = rows[0]!;
  return {
    cutoff: iso(r.cutoff)!,
    applied: r.applied === true,
    doneTotal: Number(r.done_total),
    eligible: Number(r.eligible),
    keptRecent: Number(r.kept_recent),
    keptUnsettledPublication: Number(r.kept_unsettled_publication),
    inProgress: Number(r.in_progress),
    unknown: Number(r.unknown),
    removed: Number(r.removed),
    oldestRemoved: iso(r.oldest_removed),
    newestRemoved: iso(r.newest_removed),
    auditEventId: r.audit_event_id === null ? null : String(r.audit_event_id),
  };
}

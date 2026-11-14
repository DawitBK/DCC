import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Audit checkpoints (decision D-06, task L-09; docs/security/AUDIT.md).
 *
 * A checkpoint is one line: "at this time the audit trail had N events and its last event, number X,
 * had hash H". Lines are written to a file and copied to a second place that the people who administer
 * the DCC database cannot write to. Later, `verifyCheckpoints` asks the database whether event X still
 * has hash H. If someone rewrote the trail, even perfectly, the answer is no.
 *
 * Each line is sealed and carries the seal of the line before it, so lines cannot be dropped, reordered
 * or edited unnoticed. With a key (held by whoever keeps the copy) the seal is an HMAC that a person
 * without the key cannot forge; without a key it is a plain hash, which only catches accidental damage.
 */
export interface Checkpoint {
  v: 1;
  takenAt: string;
  lastId: number;
  lastHash: string;
  events: number;
  /** What audit_verify() said when the checkpoint was taken. */
  chainOk: boolean;
  /** Seal of the previous line; 64 zeros for the first line. */
  prev: string;
  seal: string;
}

/** Anything that can run a query: a pg Pool or Client. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const ZERO = '0'.repeat(64);

const sealOf = (c: Omit<Checkpoint, 'seal'>, key?: string): string => {
  const text = [c.v, c.takenAt, c.lastId, c.lastHash, c.events, c.chainOk, c.prev].join('|');
  return key
    ? createHmac('sha256', key).update(text).digest('hex')
    : createHash('sha256').update(text).digest('hex');
};

const sameSeal = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function head(db: Queryable): Promise<{ lastId: number; lastHash: string; events: number }> {
  const { rows } = await db.query('select last_id, last_hash, events from audit_head()');
  const r = rows[0]!;
  return {
    lastId: Number(r.last_id),
    lastHash: String(r.last_hash),
    events: Number(r.events),
  };
}

export async function takeCheckpoint(
  db: Queryable,
  options: { previous?: Checkpoint; key?: string; now?: Date } = {},
): Promise<Checkpoint> {
  const verify = (await db.query('select ok from audit_verify()')).rows[0]!;
  const h = await head(db);
  const body: Omit<Checkpoint, 'seal'> = {
    v: 1,
    takenAt: (options.now ?? new Date()).toISOString(),
    lastId: h.lastId,
    lastHash: h.lastHash,
    events: h.events,
    chainOk: verify.ok === true,
    prev: options.previous?.seal ?? ZERO,
  };
  return { ...body, seal: sealOf(body, options.key) };
}

export function readCheckpoints(file: string): Checkpoint[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      try {
        return JSON.parse(line) as Checkpoint;
      } catch {
        throw new Error(
          `${file}: line ${i + 1} is not a checkpoint (the file was damaged or edited)`,
        );
      }
    });
}

export function appendCheckpoint(file: string, checkpoint: Checkpoint): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(checkpoint)}\n`, 'utf8');
}

export interface CheckpointReport {
  ok: boolean;
  checked: number;
  /** Plain sentences, the earliest problem first. Empty when ok. */
  problems: string[];
}

/**
 * Compares the remembered checkpoints with the database as it is now. Anything in `problems` is a
 * security incident to escalate, not a maintenance task: see docs/security/AUDIT.md.
 */
export async function verifyCheckpoints(
  db: Queryable,
  checkpoints: Checkpoint[],
  options: { key?: string } = {},
): Promise<CheckpointReport> {
  const problems: string[] = [];

  let prev = ZERO;
  checkpoints.forEach((c, i) => {
    const { seal, ...body } = c;
    const at = `checkpoint ${i + 1} (${c.takenAt})`;
    if (c.prev !== prev)
      problems.push(`${at}: a line before it is missing, reordered or was replaced.`);
    if (!sameSeal(seal, sealOf(body, options.key)))
      problems.push(
        `${at}: its seal does not match its contents${options.key ? ' for this key' : ''}: the checkpoint file was edited.`,
      );
    prev = seal;
  });

  const now = await head(db);
  for (const [i, c] of checkpoints.entries()) {
    const at = `checkpoint ${i + 1} (${c.takenAt})`;
    if (!c.chainOk)
      problems.push(`${at}: the audit chain was already broken when this checkpoint was taken.`);
    if (now.events < c.events)
      problems.push(
        `${at}: the audit trail had ${c.events} events then and has ${now.events} now: events were removed.`,
      );
    if (c.lastId === 0) continue;
    const row = (await db.query('select audit_hash_at($1) as hash', [c.lastId])).rows[0]!;
    if (row.hash === null)
      problems.push(`${at}: audit event ${c.lastId} no longer exists: events were removed.`);
    else if (row.hash !== c.lastHash)
      problems.push(
        `${at}: audit event ${c.lastId} has a different hash now: the audit trail was rewritten.`,
      );
  }

  const chain = (await db.query('select ok, first_broken_id from audit_verify()')).rows[0]!;
  if (chain.ok !== true)
    problems.push(
      `The audit chain is broken now, first at event ${String(chain.first_broken_id)}.`,
    );

  return { ok: problems.length === 0, checked: checkpoints.length, problems };
}

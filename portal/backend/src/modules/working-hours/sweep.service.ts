import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'kysely';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { SYSTEM_USER_ID, systemCheckContext } from '../shared/tenant-scope';

/** One piece of periodic work for ONE company. Run it inside `systemCheckContext(companyId)`. */
export type SweepJob = (companyId: string, now: Date) => Promise<void>;

export interface SweepFailure {
  job: string;
  companyId: string;
  error: string;
}

/**
 * The in-process sweep (decision D-31, 2026-11-26): the escalation clocks of the inbox, the approvals and
 * the post-incident review must notify people even when nobody has the page open. It is a timer inside
 * the backend process, not a worker, a queue or a new service. Each feature registers its job; the sweep
 * runs every job for every active company, one failure never stopping the others. Escalations are
 * recorded once per level (`escalation_events`), so running a sweep twice, or from two screens, tells
 * nobody twice. It never publishes, approves or sends anything on its own: it only notifies.
 *
 * `DCC_SWEEP_SECONDS`: interval in seconds, default 60; `0` switches the timer off (it is off under
 * test). `runOnce` is also what the tests call.
 */
@Injectable()
export class SweepService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Sweep');
  private readonly jobs = new Map<string, SweepJob>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly tenant: TenantDb) {}

  register(name: string, job: SweepJob): void {
    this.jobs.set(name, job);
  }

  onApplicationBootstrap(): void {
    const fallback = process.env.NODE_ENV === 'test' ? 0 : 60;
    const seconds = Number(process.env.DCC_SWEEP_SECONDS ?? fallback);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.timer = setInterval(() => void this.runOnce(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs every job for every active company. Returns the failures (empty when all went well). */
  async runOnce(now: Date = new Date()): Promise<SweepFailure[]> {
    if (this.running) return [];
    this.running = true;
    const failures: SweepFailure[] = [];
    try {
      const companyIds = await this.tenant.run(
        { userId: SYSTEM_USER_ID, groupIds: [], companyIds: [] },
        async (trx) => {
          const { rows } = await sql<{
            company_id: string;
          }>`select company_id from sweep_company_ids()`.execute(trx);
          return rows.map((r) => r.company_id);
        },
      );
      for (const companyId of companyIds) {
        for (const [name, job] of this.jobs) {
          try {
            await job(companyId, now);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push({ job: name, companyId, error: message });
            this.log.error(`Sweep job ${name} failed for a company: ${message}`);
          }
        }
      }
    } finally {
      this.running = false;
    }
    return failures;
  }

  /** The tenant context every job runs in for one company. */
  contextFor(companyId: string) {
    return systemCheckContext(companyId);
  }
}

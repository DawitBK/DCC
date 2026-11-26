import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { supportsInbox, type InboxMessage, type OperationalEngine } from '@dcc/engine-client';
import { ROLES, ROLE_PERMISSIONS, DEFAULT_INBOX_TARGETS } from '@dcc/contracts';
import { sql, type Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';
import { systemCheckContext } from '../shared/tenant-scope';
import { WorkingHoursService } from '../working-hours/working-hours.service';
import { SweepService } from '../working-hours/sweep.service';
import { inboxEscalationLevel, type InboxTargets } from './inbox-tracking';
import { OPERATIONAL_ENGINE } from './operational-engine.provider';

const DAY = 24 * 60 * 60 * 1000;
/** The sweep looks back this far (sheet E, backlog H-19): older messages are shown but never escalated. */
export const ESCALATION_WINDOW_DAYS = 7;
const INSERT_CHUNK = 200;

/** A message of the inbox and the account it arrived on, as the escalation needs it (no text, no author). */
export interface ClockEntry {
  accountId: string;
  accountName: string;
  engineMessageId: string;
  receivedAt: Date;
}

/**
 * Round 2, inbox clock (backlog H-19, RQ-031, RQ-023): the response clock of a message and what happens at each
 * level of the ladder (sheet E-06). It runs in the SWEEP (every minute, for every company, even when nobody has
 * the inbox open) and when the inbox list is read. Each level is recorded once in `escalation_events`, so it
 * notifies once however often either asks. Escalation never replies, publishes or approves: it only notifies,
 * and at 150% hands the message to another person who may reply.
 *
 *   level 1 (100%)  the assignee and the Digital Marketing Manager are reminded
 *   level 2 (150%)  the message moves to the backup responder (the other holder of `inbox.reply` with the fewest
 *                   open messages); they and the previous assignee are told; nobody to move to: the manager is told
 *   level 3 (200%)  the Marketing & Communications Manager (company_executive, group_marketing) is told, and the
 *                   miss is counted for the monthly report (the level-3 row of `escalation_events`)
 */
@Injectable()
export class InboxClockService implements OnModuleInit {
  private readonly log = new Logger('InboxClock');

  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly hours: WorkingHoursService,
    private readonly sweep: SweepService,
    @Inject(OPERATIONAL_ENGINE) private readonly engine: OperationalEngine,
  ) {}

  onModuleInit(): void {
    this.sweep.register('inbox-clock', (companyId, now) => this.sweepCompany(companyId, now));
  }

  /** The targets of a company: its row, or the defaults (60 / 240 / 1440, urgent counted in working time). */
  async targetsOf(trx: Transaction<DB>, companyId: string): Promise<InboxTargets> {
    const row = await trx
      .selectFrom('inbox_settings')
      .select([
        'urgent_target_minutes',
        'normal_target_minutes',
        'low_target_minutes',
        'urgent_round_the_clock',
      ])
      .where('company_id', '=', companyId)
      .executeTakeFirst();
    return row
      ? {
          urgent: row.urgent_target_minutes,
          normal: row.normal_target_minutes,
          low: row.low_target_minutes,
          urgentRoundTheClock: row.urgent_round_the_clock,
        }
      : { ...DEFAULT_INBOX_TARGETS, urgentRoundTheClock: false };
  }

  /** Users holding `inbox.reply` for the company (its own people and its group's). Ids only. */
  async replyHolders(trx: Transaction<DB>, companyId: string): Promise<string[]> {
    const roles = ROLES.filter((r) => ROLE_PERMISSIONS[r].includes('inbox.reply'));
    const { rows } = await sql<{
      user_id: string;
    }>`select user_id from notification_recipients(${companyId}::uuid, ${sql.val(roles)}::text[])`.execute(
      trx,
    );
    return rows.map((r) => r.user_id);
  }

  /**
   * One sweep step for one company: read the last 7 days of every connected account through the engine, make
   * sure each unanswered message has its row (id and received time only, never text), and escalate.
   */
  async sweepCompany(companyId: string, now: Date): Promise<void> {
    if (this.engine.capabilities().inbox !== true || !supportsInbox(this.engine)) return;
    const inbox = this.engine;
    const accounts = await this.tenant.run(systemCheckContext(companyId), (trx) =>
      trx
        .selectFrom('social_accounts')
        .select(['id', 'display_name', 'engine_channel_id'])
        .where('company_id', '=', companyId)
        .where('engine_channel_id', 'is not', null)
        .where('status', '<>', 'archived')
        .execute(),
    );
    const entries: ClockEntry[] = [];
    for (const account of accounts) {
      let messages: InboxMessage[];
      try {
        messages = await inbox.listInbox(
          { from: new Date(now.getTime() - ESCALATION_WINDOW_DAYS * DAY), to: now },
          account.engine_channel_id!,
        );
      } catch (error) {
        // One account the engine cannot answer must not stop the others.
        this.log.warn(
          `Inbox clock: the engine could not be read for one account: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      for (const m of messages)
        if (!m.replied)
          entries.push({
            accountId: account.id,
            accountName: account.display_name,
            engineMessageId: m.engineMessageId,
            receivedAt: m.receivedAt,
          });
    }
    await this.escalate(companyId, entries, now, { createMissing: true });
  }

  /**
   * Escalate the given unanswered messages of one company. `createMissing` (the sweep) first adds the row of
   * every message nobody has touched; the list read passes false and only escalates messages that have a row.
   * Messages older than the window are skipped. One message failing never stops the others.
   */
  async escalate(
    companyId: string,
    entries: ClockEntry[],
    now: Date,
    options: { createMissing: boolean },
  ): Promise<void> {
    const cutoff = now.getTime() - ESCALATION_WINDOW_DAYS * DAY;
    const recent = entries.filter(
      (e) => e.receivedAt.getTime() >= cutoff && e.receivedAt.getTime() <= now.getTime(),
    );
    if (recent.length === 0) return;
    if (options.createMissing) {
      await this.tenant.run(systemCheckContext(companyId), async (trx) => {
        for (let i = 0; i < recent.length; i += INSERT_CHUNK)
          await trx
            .insertInto('inbox_items')
            .values(
              recent.slice(i, i + INSERT_CHUNK).map((e) => ({
                company_id: companyId,
                social_account_id: e.accountId,
                engine_message_id: e.engineMessageId,
                received_at: e.receivedAt,
              })),
            )
            .onConflict((oc) => oc.columns(['social_account_id', 'engine_message_id']).doNothing())
            .execute();
      });
    }
    for (const entry of recent) {
      try {
        await this.escalateOne(companyId, entry, now);
      } catch (error) {
        this.log.error(
          `Inbox clock: escalation failed for one message: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async escalateOne(companyId: string, entry: ClockEntry, now: Date): Promise<void> {
    await this.tenant.run(systemCheckContext(companyId), async (trx) => {
      const item = await trx
        .selectFrom('inbox_items')
        .selectAll()
        .where('social_account_id', '=', entry.accountId)
        .where('engine_message_id', '=', entry.engineMessageId)
        .forUpdate()
        .executeTakeFirst();
      if (!item || item.first_response_at !== null) return;
      const [calendar, targets] = await Promise.all([
        this.hours.calendarOf(trx, companyId),
        this.targetsOf(trx, companyId),
      ]);
      const level = inboxEscalationLevel({
        receivedAt: item.received_at,
        priority: item.priority,
        targets,
        answered: false,
        now,
        calendar,
      });
      let assignee = item.assigned_to;
      for (let l = 1; l <= level; l += 1) {
        const inserted = await trx
          .insertInto('escalation_events')
          .values({
            company_id: companyId,
            kind: 'inbox',
            target_id: item.id,
            level: l,
            // The time of the miss is the time the sweep judged it, so the monthly count follows the clock it was given.
            created_at: now,
          })
          .onConflict((oc) => oc.columns(['kind', 'target_id', 'level']).doNothing())
          .returning('id')
          .executeTakeFirst();
        if (!inserted) continue;
        const what = `A ${item.priority} message on ${entry.accountName}`;
        const base = { companyId, targetType: 'inbox_item', targetId: item.id } as const;
        const details: Record<string, unknown> = {
          level: l,
          priority: item.priority,
          engineMessageId: entry.engineMessageId,
          assignedTo: assignee,
        };
        if (l === 1) {
          if (assignee)
            await this.notifications.notifyUser(trx, {
              ...base,
              recipientUserId: assignee,
              eventType: 'inbox.escalated',
              summary: `${what} has reached its response time. Please answer it.`,
            });
          details.notified = await this.notifications.notifyRoles(trx, {
            ...base,
            roles: ['company_marketing_manager'],
            eventType: 'inbox.escalated',
            summary: `${what} has reached its response time and is not answered.`,
            excludeUserIds: assignee ? [assignee] : [],
          });
        } else if (l === 2) {
          const holders = (await this.replyHolders(trx, companyId)).filter((id) => id !== assignee);
          const backup = await this.leastLoaded(trx, companyId, holders);
          if (backup) {
            await trx
              .updateTable('inbox_items')
              .set({
                assigned_to: backup,
                assigned_by: null,
                assigned_at: now,
                updated_at: now,
              })
              .where('id', '=', item.id)
              .execute();
            await this.notifications.notifyUser(trx, {
              ...base,
              recipientUserId: backup,
              eventType: 'inbox.escalated',
              summary: `${what} was not answered in time and has been handed to you.`,
            });
            if (assignee)
              await this.notifications.notifyUser(trx, {
                ...base,
                recipientUserId: assignee,
                eventType: 'inbox.escalated',
                summary: `${what} was not answered in time and has been handed to someone else.`,
              });
            details.movedTo = backup;
            details.movedFrom = assignee;
            assignee = backup;
          } else {
            details.noBackup = true;
            details.notified = await this.notifications.notifyRoles(trx, {
              ...base,
              roles: ['company_marketing_manager'],
              eventType: 'inbox.escalated',
              summary: `${what} is not answered and there is nobody else to hand it to.`,
            });
          }
        } else {
          details.notified = await this.notifications.notifyRoles(trx, {
            ...base,
            roles: ['company_executive', 'group_marketing'],
            eventType: 'inbox.escalated',
            summary: `${what} is still not answered at twice its response time.`,
          });
          details.countedForReport = true;
        }
        // The audit event is written last: it takes a lock that serialises audit writers.
        await this.audit.record(trx, {
          action: AuditActions.inboxEscalated,
          actorUserId: null,
          actorSubject: 'system:inbox-clock',
          targetType: 'inbox_item',
          targetId: item.id,
          companyId,
          details,
        });
      }
    });
  }

  /** Of these people, the one with the fewest open assigned messages (ties: the lowest id, so the choice is stable). */
  private async leastLoaded(
    trx: Transaction<DB>,
    companyId: string,
    candidates: string[],
  ): Promise<string | null> {
    if (candidates.length === 0) return null;
    const rows = await trx
      .selectFrom('inbox_items')
      .select(['assigned_to'])
      .select((eb) => eb.fn.countAll().as('open'))
      .where('company_id', '=', companyId)
      .where('assigned_to', 'in', candidates)
      .where('first_response_at', 'is', null)
      .groupBy('assigned_to')
      .execute();
    const load = new Map(rows.map((r) => [r.assigned_to!, Number(r.open)]));
    return (
      [...candidates].sort(
        (a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b),
      )[0] ?? null
    );
  }
}

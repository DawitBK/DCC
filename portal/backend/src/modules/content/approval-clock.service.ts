import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Role } from '@dcc/contracts';
import type { Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';
import { systemCheckContext } from '../shared/tenant-scope';
import { elapsedMinutes, escalationLevel, type WorkingCalendar } from '../shared/working-time';
import { SweepService } from '../working-hours/sweep.service';
import { WorkingHoursService } from '../working-hours/working-hours.service';
import {
  APPROVER_ROLE_LIST,
  approvalIsPast,
  EMERGENCY_LADDER,
  ESCALATION_ROLES,
  ladderFor,
} from './approval-state';

type Trx = Transaction<DB>;

/** The sweep did it, nobody pressed anything: audited with no human actor. */
const SYSTEM_ACTOR = { actorUserId: null, actorSubject: 'system:sweep' } as const;

const percent = (step: number) => Math.round(step * 100);

const formatMinutes = (minutes: number): string =>
  minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;

/**
 * Round 2, approvals: the clocks that run without anyone pressing anything (sheet C1-07, C1-11, C1-14):
 *  - an approval that nobody used within seven days expires;
 *  - a pending request with a time limit climbs the escalation ladder (reminder, stand-in, escalation roles,
 *    escalation roles again and counted for the monthly report);
 *  - an emergency approval whose confirmation is still owed is chased after 24 and 48 hours.
 * Every level is recorded once in `escalation_events`, so running the sweep twice tells nobody twice.
 * NOTHING here approves, rejects or publishes: it only records a state that time has already changed, and notifies.
 */
@Injectable()
export class ApprovalClockService implements OnModuleInit {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly working: WorkingHoursService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register('approvals', (companyId, now) => this.runForCompany(companyId, now));
  }

  /** What the sweep does for one company. Also what the tests call, with a `now` they control. */
  async runForCompany(companyId: string, now: Date): Promise<void> {
    await this.tenant.run(systemCheckContext(companyId), (trx) =>
      this.expireDue(trx, companyId, now),
    );
    await this.tenant.run(systemCheckContext(companyId), async (trx) =>
      this.escalatePending(trx, companyId, await this.working.calendarOf(trx, companyId), now),
    );
    await this.tenant.run(systemCheckContext(companyId), (trx) =>
      this.chaseEmergencies(trx, companyId, now),
    );
  }

  /** Records every approval of this company whose seven days have run out. Returns how many were expired. */
  async expireDue(trx: Trx, companyId: string, now: Date): Promise<number> {
    const due = await trx
      .selectFrom('approval_requests')
      .select('id')
      .where('company_id', '=', companyId)
      .where('status', '=', 'approved')
      .where('valid_until', '<', now)
      .execute();
    let expired = 0;
    for (const { id } of due) if (await this.expireRequest(trx, id, now)) expired += 1;
    return expired;
  }

  /**
   * Moves one approved request, and its item when the item was only waiting to be published, to `expired`;
   * tells the writer and the approvers; audits. Does nothing (false) when the approval is still valid or the
   * request is no longer approved. Safe to call from a read: whoever notices first records it.
   */
  async expireRequest(trx: Trx, requestId: string, now: Date): Promise<boolean> {
    const request = await trx
      .selectFrom('approval_requests')
      .select(['id', 'company_id', 'content_version_id', 'requested_by', 'status', 'valid_until'])
      .where('id', '=', requestId)
      .executeTakeFirst();
    if (!request || request.status !== 'approved' || !approvalIsPast(request.valid_until, now))
      return false;

    const updated = await trx
      .updateTable('approval_requests')
      .set({ status: 'expired', expired_at: now })
      .where('id', '=', request.id)
      .where('status', '=', 'approved')
      .returning('id')
      .executeTakeFirst();
    if (!updated) return false;

    const version = await trx
      .selectFrom('content_versions')
      .select('content_item_id')
      .where('id', '=', request.content_version_id)
      .executeTakeFirstOrThrow();
    const item = await trx
      .selectFrom('content_items')
      .select(['id', 'created_by', 'current_version_id', 'status'])
      .where('id', '=', version.content_item_id)
      .executeTakeFirstOrThrow();
    // Only an item that was waiting to be published is "expired"; one already published stays published, and
    // one with a post queued at the engine keeps its status until that post goes out (it publishes before expiry).
    const waiting =
      item.status === 'approved' && item.current_version_id === request.content_version_id;
    let itemExpired = false;
    if (waiting) {
      const queued = await trx
        .selectFrom('publications')
        .select('id')
        .where('content_version_id', '=', request.content_version_id)
        .where('status', 'in', ['scheduled', 'pending'])
        .executeTakeFirst();
      if (!queued) {
        await trx
          .updateTable('content_items')
          .set({ status: 'expired', updated_at: now })
          .where('id', '=', item.id)
          .where('status', '=', 'approved')
          .execute();
        itemExpired = true;
      }
      const approvers = await trx
        .selectFrom('approval_decisions')
        .select('decided_by')
        .distinct()
        .where('approval_request_id', '=', request.id)
        .where('decision', '=', 'approved')
        .execute();
      const told = new Set<string>();
      for (const userId of [
        item.created_by,
        request.requested_by,
        ...approvers.map((a) => a.decided_by),
      ]) {
        if (told.has(userId)) continue;
        told.add(userId);
        await this.notifications.notifyUser(trx, {
          companyId: request.company_id,
          recipientUserId: userId,
          eventType: 'approval.expired',
          targetType: 'content_item',
          targetId: item.id,
          summary:
            'An approval ran out: approved content must be published within 7 days. Submit it again to publish.',
        });
      }
    }
    await this.audit.record(trx, {
      ...SYSTEM_ACTOR,
      action: AuditActions.approvalExpired,
      targetType: 'content_item',
      targetId: item.id,
      companyId: request.company_id,
      details: {
        approvalRequestId: request.id,
        contentVersionId: request.content_version_id,
        validUntil: request.valid_until?.toISOString() ?? null,
        itemExpired,
        itemWasWaiting: waiting,
      },
    });
    return true;
  }

  /** Climbs the ladder of every pending request with a time limit. Returns how many levels fired. */
  async escalatePending(
    trx: Trx,
    companyId: string,
    cal: WorkingCalendar,
    now: Date,
  ): Promise<number> {
    // Only requests that are still the item's live review: an edit since submission makes the old request moot.
    const rows = await trx
      .selectFrom('approval_requests as r')
      .innerJoin('content_versions as v', 'v.id', 'r.content_version_id')
      .innerJoin('content_items as i', 'i.id', 'v.content_item_id')
      .select([
        'r.id',
        'r.company_id',
        'r.requested_by',
        'r.requested_at',
        'r.approver_roles',
        'r.time_limit_hours',
        'r.clock',
        'r.escalation_level',
        'i.id as item_id',
        'i.created_by as writer',
      ])
      .where('r.company_id', '=', companyId)
      .where('r.status', '=', 'pending')
      .where('r.time_limit_hours', 'is not', null)
      .whereRef('i.current_version_id', '=', 'r.content_version_id')
      .where('i.status', '=', 'in_review')
      .execute();
    let fired = 0;
    for (const row of rows) {
      const limitMinutes = row.time_limit_hours! * 60;
      const ladder = ladderFor(row.clock, limitMinutes);
      const level = escalationLevel(
        elapsedMinutes(row.requested_at, now, row.clock, cal),
        limitMinutes,
        ladder,
      );
      for (let step = 1; step <= level; step += 1) {
        const inserted = await trx
          .insertInto('escalation_events')
          .values({ company_id: companyId, kind: 'approval', target_id: row.id, level: step })
          .onConflict((oc) => oc.columns(['kind', 'target_id', 'level']).doNothing())
          .returning('id')
          .executeTakeFirst();
        if (!inserted) continue;
        fired += 1;
        await this.fireLevel(trx, row, step, ladder[step - 1]!, limitMinutes);
      }
      if (level > row.escalation_level)
        await trx
          .updateTable('approval_requests')
          .set({ escalation_level: level })
          .where('id', '=', row.id)
          .execute();
    }
    return fired;
  }

  private async fireLevel(
    trx: Trx,
    row: {
      id: string;
      company_id: string;
      requested_by: string;
      approver_roles: string[];
      item_id: string;
      writer: string;
    },
    level: number,
    stepFraction: number,
    limitMinutes: number,
  ): Promise<void> {
    // Nobody who wrote any version may approve it, so they are never the ones reminded to approve.
    const authors = (
      await trx
        .selectFrom('content_versions')
        .select('created_by')
        .distinct()
        .where('content_item_id', '=', row.item_id)
        .execute()
    ).map((a) => a.created_by);
    const everyAuthor = [...new Set([row.writer, row.requested_by, ...authors])];
    const base = { companyId: row.company_id, targetType: 'content_item', targetId: row.item_id };
    const named = row.approver_roles as Role[];
    const approverRoles = named.length ? named : APPROVER_ROLE_LIST;
    const how = `${percent(stepFraction)}% of the time limit (${formatMinutes(limitMinutes)}) has passed`;
    let notified: string[];
    if (level === 1) {
      notified = await this.notifications.notifyRoles(trx, {
        ...base,
        roles: approverRoles,
        eventType: 'approval.reminder',
        summary: `An approval is waiting: ${how}.`,
        excludeUserIds: everyAuthor,
      });
    } else if (level === 2) {
      // The stand-in: everyone else who may approve (the request opens to them from now on), plus the writer.
      notified = await this.notifications.notifyRoles(trx, {
        ...base,
        roles: APPROVER_ROLE_LIST.filter((r) => !named.includes(r)),
        eventType: 'approval.escalated',
        summary: `An approval is overdue and passes to you as stand-in: ${how}.`,
        excludeUserIds: everyAuthor,
      });
      for (const userId of new Set([row.writer, row.requested_by])) {
        await this.notifications.notifyUser(trx, {
          ...base,
          recipientUserId: userId,
          eventType: 'approval.escalated',
          summary: `Your content is still waiting for approval: ${how}. The stand-in approvers were told.`,
        });
        notified.push(userId);
      }
    } else {
      notified = await this.notifications.notifyRoles(trx, {
        ...base,
        roles: ESCALATION_ROLES,
        eventType: 'approval.escalated',
        summary: `An approval is badly overdue: ${how}.${
          level >= 4 ? ' It is counted in the monthly report.' : ''
        }`,
      });
    }
    await this.audit.record(trx, {
      ...SYSTEM_ACTOR,
      action: level === 1 ? AuditActions.approvalReminded : AuditActions.approvalEscalated,
      targetType: 'content_item',
      targetId: row.item_id,
      companyId: row.company_id,
      details: {
        approvalRequestId: row.id,
        level,
        stepPercent: percent(stepFraction),
        limitMinutes,
        notified: notified.length,
      },
    });
  }

  /** The second approval owed after an emergency post: chased at 24 and 48 hours (round the clock). */
  async chaseEmergencies(trx: Trx, companyId: string, now: Date): Promise<number> {
    const rows = await trx
      .selectFrom('approval_requests as r')
      .innerJoin('content_versions as v', 'v.id', 'r.content_version_id')
      .select(['r.id', 'r.emergency_at', 'v.content_item_id as item_id'])
      .where('r.company_id', '=', companyId)
      .where('r.emergency', '=', true)
      .where('r.emergency_confirmed_at', 'is', null)
      .where('r.status', '=', 'approved')
      .execute();
    let fired = 0;
    for (const row of rows) {
      if (!row.emergency_at) continue;
      const hours = elapsedMinutes(row.emergency_at, now, 'continuous') / 60;
      const level = escalationLevel(hours, 24, EMERGENCY_LADDER);
      for (let step = 1; step <= level; step += 1) {
        const inserted = await trx
          .insertInto('escalation_events')
          .values({
            company_id: companyId,
            kind: 'emergency_followup',
            target_id: row.id,
            level: step,
          })
          .onConflict((oc) => oc.columns(['kind', 'target_id', 'level']).doNothing())
          .returning('id')
          .executeTakeFirst();
        if (!inserted) continue;
        fired += 1;
        const notified = await this.notifications.notifyRoles(trx, {
          companyId,
          roles: ESCALATION_ROLES,
          eventType: 'approval.followup_due',
          targetType: 'content_item',
          targetId: row.item_id,
          summary: `A post approved in an emergency still has no second approval, ${step * 24} hours later.${
            step >= 2 ? ' It is counted in the monthly report.' : ''
          }`,
        });
        await this.audit.record(trx, {
          ...SYSTEM_ACTOR,
          action: AuditActions.approvalEscalated,
          targetType: 'content_item',
          targetId: row.item_id,
          companyId,
          details: {
            approvalRequestId: row.id,
            kind: 'emergency_followup',
            level: step,
            hoursSinceEmergency: step * 24,
            notified: notified.length,
          },
        });
      }
    }
    return fired;
  }
}

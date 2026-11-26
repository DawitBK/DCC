import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ROLES, ROLE_PERMISSIONS, type InboxLanguage } from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';
import { systemCheckContext } from '../shared/tenant-scope';
import { SweepService } from '../working-hours/sweep.service';
import { InboxClockService, type ClockEntry } from './inbox-clock.service';

const INSERT_CHUNK = 200;
/** Recorded in `escalation_events` (kind `inbox`) so "nobody to give it to" tells the manager once per message. */
export const NOBODY_AVAILABLE_LEVEL = 6;

/**
 * Who is told when nobody can answer a company's inbox. The Digital Marketing Manager always holds `inbox.reply`, so a
 * company with nobody to reply has no such manager: the people who can manage its inbox (and so fix the responders)
 * are told instead, which includes the manager whenever there is one.
 */
const INBOX_MANAGER_ROLES = ROLES.filter((r) => ROLE_PERMISSIONS[r].includes('inbox.manage'));

type Via = 'primary_language' | 'primary' | 'other_responder';

/**
 * Round 3, automatic assignment (sheet E-03, E-11, E-15): the sweep job `inbox-routing` gives every unassigned,
 * unanswered message of the last 7 days to a responder, in this order:
 *
 *   1. a primary responder whose languages include the message's language,
 *   2. any primary responder,
 *   3. any other holder of `inbox.reply` who is not a backup responder,
 *
 * and inside the first group that has someone, the person with the fewest open assigned messages (ties: the lowest
 * user id). A responder who lost `inbox.reply` is ignored. With nobody at all the message stays unassigned and the
 * people who manage the inbox (the Digital Marketing Manager first of all) are told once.
 *
 * The system never reassigns: it only touches a message nobody has ever been assigned (so a message a person cleared
 * on purpose stays cleared and can be claimed). The assignment has no human assigner (`assigned_by` null), is not a
 * reassignment, never restarts the response clock (which runs from the arrival), notifies the assignee and is audited.
 */
@Injectable()
export class InboxRoutingService implements OnModuleInit {
  private readonly log = new Logger('InboxRouting');

  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly clock: InboxClockService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register('inbox-routing', (companyId, now) => this.routeCompany(companyId, now));
  }

  /** One sweep step for one company: make sure every unanswered message has a row, then route the unassigned ones. */
  async routeCompany(companyId: string, now: Date): Promise<void> {
    const entries = await this.clock.unansweredEntries(companyId, now);
    const recent = entries.filter((e) => e.receivedAt.getTime() <= now.getTime());
    if (recent.length === 0) return;
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
    // Oldest first: the message that has waited longest gets the first pick of the least loaded person.
    for (const entry of [...recent].sort(
      (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
    )) {
      try {
        await this.routeOne(companyId, entry, now);
      } catch (error) {
        this.log.error(
          `Inbox routing failed for one message: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async routeOne(companyId: string, entry: ClockEntry, now: Date): Promise<void> {
    await this.tenant.run(systemCheckContext(companyId), async (trx) => {
      const item = await trx
        .selectFrom('inbox_items')
        .select(['id', 'assigned_to', 'first_assigned_at', 'first_response_at', 'priority'])
        .where('social_account_id', '=', entry.accountId)
        .where('engine_message_id', '=', entry.engineMessageId)
        .forUpdate()
        .executeTakeFirst();
      if (!item || item.assigned_to !== null || item.first_assigned_at !== null) return;
      if (item.first_response_at !== null) return;

      const holders = await this.clock.replyHolders(trx, companyId);
      const responders = await trx
        .selectFrom('inbox_responders')
        .select(['user_id', 'kind', 'languages'])
        .where('company_id', '=', companyId)
        .execute();
      const holds = new Set(holders);
      const live = responders.filter((r) => holds.has(r.user_id));
      const language: InboxLanguage = entry.language;
      const primaries = live.filter((r) => r.kind === 'primary');
      const backups = new Set(live.filter((r) => r.kind === 'backup').map((r) => r.user_id));
      const groups: Array<{ via: Via; ids: string[] }> = [
        {
          via: 'primary_language',
          ids: primaries.filter((r) => r.languages.includes(language)).map((r) => r.user_id),
        },
        { via: 'primary', ids: primaries.map((r) => r.user_id) },
        { via: 'other_responder', ids: holders.filter((id) => !backups.has(id)) },
      ];
      let chosen: { via: Via; userId: string } | null = null;
      for (const group of groups) {
        const userId = await this.clock.leastLoaded(trx, companyId, group.ids);
        if (userId) {
          chosen = { via: group.via, userId };
          break;
        }
      }

      const base = { companyId, targetType: 'inbox_item', targetId: item.id } as const;
      if (!chosen) {
        const inserted = await trx
          .insertInto('escalation_events')
          .values({
            company_id: companyId,
            kind: 'inbox',
            target_id: item.id,
            level: NOBODY_AVAILABLE_LEVEL,
            created_at: now,
          })
          .onConflict((oc) => oc.columns(['kind', 'target_id', 'level']).doNothing())
          .returning('id')
          .executeTakeFirst();
        if (!inserted) return;
        const told = await this.notifications.notifyRoles(trx, {
          ...base,
          roles: INBOX_MANAGER_ROLES,
          eventType: 'inbox.escalated',
          summary: `A ${item.priority} message on ${entry.accountName} has nobody to answer it: no responder can reply for this company.`,
        });
        await this.audit.record(trx, {
          action: AuditActions.inboxEscalated,
          actorUserId: null,
          actorSubject: 'system:inbox-routing',
          targetType: 'inbox_item',
          targetId: item.id,
          companyId,
          details: {
            level: NOBODY_AVAILABLE_LEVEL,
            nobodyToAssign: true,
            engineMessageId: entry.engineMessageId,
            language,
            notified: told,
          },
        });
        return;
      }

      await trx
        .updateTable('inbox_items')
        .set({
          assigned_to: chosen.userId,
          assigned_by: null,
          assigned_at: now,
          assigned_automatically: true,
          // Not a reassignment, but a later clear and assign by a person is (the same rule as a manual assignment).
          first_assigned_at: now,
          updated_at: now,
        })
        .where('id', '=', item.id)
        .execute();
      await this.notifications.notifyUser(trx, {
        ...base,
        recipientUserId: chosen.userId,
        eventType: 'inbox.assigned',
        summary: `A message on ${entry.accountName} was assigned to you automatically.`,
      });
      await this.audit.record(trx, {
        action: AuditActions.inboxAutoAssigned,
        actorUserId: null,
        actorSubject: 'system:inbox-routing',
        targetType: 'inbox_item',
        targetId: item.id,
        companyId,
        details: {
          engineMessageId: entry.engineMessageId,
          assignedTo: chosen.userId,
          language,
          via: chosen.via,
        },
      });
    });
  }
}

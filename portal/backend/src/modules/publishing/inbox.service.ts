import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  supportsInbox,
  type InboxEngine,
  type InboxMessage,
  type OperationalEngine,
} from '@dcc/engine-client';
import {
  type AssignInboxMessageRequest,
  type InboxAssigneeDto,
  type InboxAssignmentDto,
  type InboxClockMessageDto,
  type InboxPriorityDto,
  type InboxQuery,
  type ReplyInboxRequest,
  type SetInboxPriorityRequest,
} from '@dcc/contracts';
import { sql, type Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';
import { WorkingHoursService } from '../working-hours/working-hours.service';
import { FreezeService } from './freeze.service';
import { InboxClockService, type ClockEntry } from './inbox-clock.service';
import { clockFor, inboxEscalationLevel, trackResponse } from './inbox-tracking';
import { OPERATIONAL_ENGINE } from './operational-engine.provider';

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const REPLY_LOOKBACK_DAYS = 90;

/**
 * The unified inbox (FR-13): comments and direct messages of the connected accounts, read from the
 * operational engine. DCC stores no message: it reads them through the engine, decides who may see
 * and answer them, and keeps the record of every reply.
 *
 * A reply is public communication, so it is authorised here, refused for a frozen or inactive
 * company, and written to the audit trail before and after it is sent.
 *
 * H-14: DCC also keeps, per message it has touched, who it is assigned to and when the first reply went
 * out through DCC (`inbox_items`), and per company a response-time target (`inbox_settings`, null = none).
 * The list shows both, with the response time and an overdue flag computed against the target.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
    private readonly notifications: NotificationsService,
    private readonly clock: InboxClockService,
    private readonly hours: WorkingHoursService,
    @Inject(OPERATIONAL_ENGINE) private readonly engine: OperationalEngine,
  ) {}

  private inbox(): InboxEngine {
    if (this.engine.capabilities().inbox !== true || !supportsInbox(this.engine))
      throw new NotImplementedException('The operational engine has no inbox yet.');
    return this.engine;
  }

  async list(access: Access, query: InboxQuery): Promise<InboxClockMessageDto[]> {
    const inbox = this.inbox();
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY);
    if (from > to) throw new BadRequestException('"from" is after "to".');

    const accounts = await this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'inbox.read');
      const scope = query.companyId
        ? companyIds.filter((id) => id === query.companyId)
        : companyIds;
      return trx
        .selectFrom('social_accounts')
        .select(['id', 'company_id', 'engine_channel_id', 'display_name'])
        .where('company_id', 'in', scope.length ? scope : [NIL])
        .where('engine_channel_id', 'is not', null)
        .where('status', '<>', 'archived')
        .execute();
    });

    const found: Array<{ account: (typeof accounts)[number]; message: InboxMessage }> = [];
    for (const account of accounts) {
      let messages;
      try {
        messages = await inbox.listInbox({ from, to }, account.engine_channel_id!);
      } catch {
        throw new BadGatewayException('The operational engine could not be reached.');
      }
      for (const message of messages) found.push({ account, message });
    }

    // Reading the inbox also runs the escalation ladder for the messages DCC already holds a row for (the sweep
    // does the same for every message, every minute). Each level notifies once. Never lets a failure hide the list.
    const now = new Date();
    // A message that only received the automatic acknowledgement is still unanswered (E-13), whatever the engine says.
    const acknowledged = found.length
      ? await this.tenant.run(ctxOf(access), async (trx) => {
          const rows = await trx
            .selectFrom('inbox_acknowledgements')
            .select(['social_account_id', 'engine_message_id'])
            .where('social_account_id', 'in', [...new Set(found.map((f) => f.account.id))])
            .where('acked_at', 'is not', null)
            .execute();
          return new Set(rows.map((r) => `${r.social_account_id}:${r.engine_message_id}`));
        })
      : new Set<string>();
    const byCompany = new Map<string, ClockEntry[]>();
    for (const { account, message } of found) {
      if (message.replied && !acknowledged.has(`${account.id}:${message.engineMessageId}`))
        continue;
      const entry: ClockEntry = {
        accountId: account.id,
        accountName: account.display_name,
        engineMessageId: message.engineMessageId,
        receivedAt: message.receivedAt,
      };
      byCompany.set(account.company_id, [...(byCompany.get(account.company_id) ?? []), entry]);
    }
    for (const [companyId, entries] of byCompany) {
      try {
        await this.clock.escalate(companyId, entries, now, { createMissing: false });
      } catch {
        // The list is more important than the escalation; the sweep runs it again within a minute.
      }
    }

    // What DCC itself knows about these messages, read in one pass inside the caller's scope.
    const known = await this.tenant.run(ctxOf(access), async (trx) => {
      const accountIds = [...new Set(found.map((f) => f.account.id))];
      const companyIds = [...new Set(found.map((f) => f.account.company_id))];
      const items = found.length
        ? await trx
            .selectFrom('inbox_items')
            .select([
              'social_account_id',
              'engine_message_id',
              'assigned_to',
              'assigned_at',
              'first_response_at',
              'priority',
              'priority_set_by',
              'priority_set_at',
              'reassignment_count',
              'needs_manager',
            ])
            .where('social_account_id', 'in', accountIds)
            .where(
              'engine_message_id',
              'in',
              found.map((f) => f.message.engineMessageId),
            )
            .execute()
        : [];
      // Round 2 (E-13): messages the automatic acknowledgement was sent to. The engine reports them as replied, but an
      // acknowledgement is never the first response, so they stay unanswered until a person replies through DCC.
      const acked = found.length
        ? await trx
            .selectFrom('inbox_acknowledgements')
            .select(['social_account_id', 'engine_message_id'])
            .where('social_account_id', 'in', accountIds)
            .where('acked_at', 'is not', null)
            .execute()
        : [];
      const targets = new Map<string, Awaited<ReturnType<InboxClockService['targetsOf']>>>();
      const calendars = new Map<string, Awaited<ReturnType<WorkingHoursService['calendarOf']>>>();
      for (const companyId of companyIds) {
        targets.set(companyId, await this.clock.targetsOf(trx, companyId));
        calendars.set(companyId, await this.hours.calendarOf(trx, companyId));
      }
      const assigneeIds = [
        ...new Set(items.flatMap((i) => (i.assigned_to ? [i.assigned_to] : []))),
      ];
      const names = assigneeIds.length
        ? await trx
            .selectFrom('users')
            .select(['id', 'display_name'])
            .where('id', 'in', assigneeIds)
            .execute()
        : [];
      return {
        items: new Map(items.map((i) => [`${i.social_account_id}:${i.engine_message_id}`, i])),
        targets,
        calendars,
        names: new Map(names.map((n) => [n.id, n.display_name])),
        acked: new Set(acked.map((a) => `${a.social_account_id}:${a.engine_message_id}`)),
      };
    });

    const messages: InboxClockMessageDto[] = [];
    for (const { account, message: m } of found) {
      const item = known.items.get(`${account.id}:${m.engineMessageId}`);
      const acknowledgedOnly = known.acked.has(`${account.id}:${m.engineMessageId}`);
      const replied = (m.replied && !acknowledgedOnly) || item?.first_response_at != null;
      const priority = item?.priority ?? 'normal';
      const targets = known.targets.get(account.company_id)!;
      const calendar = known.calendars.get(account.company_id)!;
      const { targetMinutes, clock } = clockFor(priority, targets);
      const tracking = trackResponse({
        receivedAt: m.receivedAt,
        firstResponseAt: item?.first_response_at ?? null,
        replied,
        targetMinutes,
        clock,
        calendar,
        now,
      });
      const dto: InboxClockMessageDto = {
        engineMessageId: m.engineMessageId,
        socialAccountId: account.id,
        companyId: account.company_id,
        kind: m.kind,
        authorName: m.authorName,
        text: m.text,
        receivedAt: m.receivedAt.toISOString(),
        replied,
        assignedTo: item?.assigned_to ?? null,
        assignedToName: item?.assigned_to ? (known.names.get(item.assigned_to) ?? null) : null,
        assignedAt: item?.assigned_at ? item.assigned_at.toISOString() : null,
        firstResponseAt: item?.first_response_at ? item.first_response_at.toISOString() : null,
        responseSeconds: tracking.responseSeconds,
        dueAt: tracking.dueAt ? tracking.dueAt.toISOString() : null,
        overdue: tracking.overdue,
        priority,
        prioritySetBy: item?.priority_set_by ?? null,
        prioritySetAt: item?.priority_set_at ? item.priority_set_at.toISOString() : null,
        escalationLevel: inboxEscalationLevel({
          receivedAt: m.receivedAt,
          priority,
          targets,
          answered: replied,
          now,
          calendar,
        }),
        needsManager: item?.needs_manager ?? false,
        reassignmentCount: item?.reassignment_count ?? 0,
      };
      if (query.assignedTo !== undefined && dto.assignedTo !== query.assignedTo) continue;
      if (
        query.unassigned !== undefined &&
        (dto.assignedTo === null) !== (query.unassigned === 'true')
      )
        continue;
      if (query.overdue !== undefined && dto.overdue !== (query.overdue === 'true')) continue;
      messages.push(dto);
    }
    return messages.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  /** The people a message of this company can be assigned to: whoever holds `inbox.reply` for it. */
  async assignees(access: Access, companyId: string): Promise<InboxAssigneeDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await trx
        .selectFrom('companies')
        .select(['id', 'group_id'])
        .where('id', '=', companyId)
        .executeTakeFirst();
      // An unknown company and another company look the same.
      if (!company || !can(access, 'inbox.reply', { groupId: company.group_id, companyId }))
        throw new NotFoundException('Company not found.');
      const ids = await this.replyHolders(trx, companyId);
      if (ids.length === 0) return [];
      const users = await trx
        .selectFrom('users')
        .select(['id', 'display_name'])
        .where('id', 'in', ids)
        .orderBy('display_name')
        .execute();
      return users.map((u) => ({ userId: u.id, displayName: u.display_name }));
    });
  }

  /**
   * Assign one message to a person who may reply for its company, or clear it (`assigneeUserId: null`).
   * The message must exist for THIS account's channel (as for a reply), the assignee must hold `inbox.reply`
   * for the company, and a change is audited in the same transaction. Assigning does not send anything.
   */
  async assign(access: Access, input: AssignInboxMessageRequest): Promise<InboxAssignmentDto> {
    const inbox = this.inbox();
    const account = await this.tenant.run(ctxOf(access), async (trx) => {
      const row = await trx
        .selectFrom('social_accounts as a')
        .innerJoin('companies as c', 'c.id', 'a.company_id')
        .select([
          'a.id',
          'a.company_id',
          'a.engine_channel_id',
          'a.status',
          'a.display_name',
          'c.group_id',
          'c.status as company_status',
        ])
        .where('a.id', '=', input.socialAccountId)
        .executeTakeFirst();
      if (!row) throw new NotFoundException('Social account not found.');
      if (!can(access, 'inbox.reply', { groupId: row.group_id, companyId: row.company_id }))
        throw new ForbiddenException('You cannot assign messages for this account.');
      if (row.company_status !== 'active')
        throw new ConflictException(`The company is ${row.company_status}.`);
      if (row.status === 'archived') throw new ConflictException('This account is archived.');
      if (!row.engine_channel_id)
        throw new BadRequestException(
          'This account is not connected to the operational engine yet.',
        );
      return row;
    });

    const message = await this.findMessage(
      inbox,
      account.engine_channel_id!,
      input.engineMessageId,
    );
    if (!message) throw new NotFoundException('Message not found for this account.');

    return this.tenant.run(ctxOf(access), async (trx) => {
      if (input.assigneeUserId !== null) {
        const holders = await this.replyHolders(trx, account.company_id);
        if (!holders.includes(input.assigneeUserId))
          throw new BadRequestException(
            'That person cannot reply for this company, so the message cannot be assigned to them.',
          );
      }
      const existing = await trx
        .selectFrom('inbox_items')
        .select(['id', 'assigned_to', 'first_assigned_at', 'reassignment_count', 'needs_manager'])
        .where('social_account_id', '=', account.id)
        .where('engine_message_id', '=', input.engineMessageId)
        .forUpdate()
        .executeTakeFirst();
      const previous = existing?.assigned_to ?? null;
      const now = new Date();
      const assignment =
        input.assigneeUserId === null
          ? { assigned_to: null, assigned_by: null, assigned_at: null }
          : { assigned_to: input.assigneeUserId, assigned_by: access.userId, assigned_at: now };
      // Round 2 (E-04): handing a message on to someone else is a reassignment (clearing and assigning again is
      // too: it must not dodge the count). It never restarts the clock, which runs from the time the message
      // arrived. The second reassignment marks the message for the Digital Marketing Manager, once.
      const isReassignment =
        existing !== undefined &&
        input.assigneeUserId !== null &&
        previous !== input.assigneeUserId &&
        (previous !== null || existing.first_assigned_at !== null);
      const reassignments = (existing?.reassignment_count ?? 0) + (isReassignment ? 1 : 0);
      const becomesManagerItem =
        isReassignment && reassignments >= 2 && existing?.needs_manager === false;
      if (existing) {
        if (previous !== input.assigneeUserId)
          await trx
            .updateTable('inbox_items')
            .set({
              ...assignment,
              ...(input.assigneeUserId !== null
                ? { first_assigned_at: existing.first_assigned_at ?? now }
                : {}),
              reassignment_count: reassignments,
              ...(becomesManagerItem ? { needs_manager: true, needs_manager_at: now } : {}),
              updated_at: now,
            })
            .where('id', '=', existing.id)
            .execute();
      } else if (input.assigneeUserId !== null) {
        try {
          await trx
            .insertInto('inbox_items')
            .values({
              company_id: account.company_id,
              social_account_id: account.id,
              engine_message_id: input.engineMessageId,
              received_at: message.receivedAt,
              ...assignment,
              first_assigned_at: now,
            })
            .execute();
        } catch (error) {
          // Two people assigned the same new message at the same moment: the second one retries.
          if ((error as { code?: string })?.code === '23505')
            throw new ConflictException('Someone else just changed this message. Try again.');
          throw error;
        }
      }
      const current =
        input.assigneeUserId === null
          ? undefined
          : await trx
              .selectFrom('inbox_items as i')
              .innerJoin('users as u', 'u.id', 'i.assigned_to')
              .select(['i.id', 'i.assigned_at', 'u.display_name'])
              .where('i.social_account_id', '=', account.id)
              .where('i.engine_message_id', '=', input.engineMessageId)
              .executeTakeFirst();
      // Tell the new assignee, in the app. Never the person who made the assignment (they know), and never on a
      // repeat of the same assignment (nothing changed). No message text or author goes into the notification.
      if (
        current &&
        input.assigneeUserId !== null &&
        previous !== input.assigneeUserId &&
        input.assigneeUserId !== access.userId
      )
        await this.notifications.notifyUser(trx, {
          companyId: account.company_id,
          recipientUserId: input.assigneeUserId,
          eventType: 'inbox.assigned',
          targetType: 'inbox_item',
          targetId: current.id,
          summary: `A message on ${account.display_name} was assigned to you.`,
        });
      if (becomesManagerItem && current)
        await this.notifications.notifyRoles(trx, {
          companyId: account.company_id,
          roles: ['company_marketing_manager'],
          eventType: 'inbox.escalated',
          targetType: 'inbox_item',
          targetId: current.id,
          summary: `A message on ${account.display_name} was handed on twice and now needs you.`,
          excludeUserIds: [access.userId],
        });
      if (previous !== input.assigneeUserId)
        await this.audit.record(trx, {
          action:
            input.assigneeUserId === null
              ? AuditActions.inboxUnassigned
              : AuditActions.inboxAssigned,
          actorUserId: access.userId,
          targetType: 'social_account',
          targetId: account.id,
          companyId: account.company_id,
          details: {
            engineMessageId: input.engineMessageId,
            assignedTo: input.assigneeUserId,
            previouslyAssignedTo: previous,
            reassignmentCount: reassignments,
            ...(becomesManagerItem ? { needsManager: true } : {}),
          },
        });
      if (input.assigneeUserId === null)
        return {
          socialAccountId: account.id,
          engineMessageId: input.engineMessageId,
          assignedTo: null,
          assignedToName: null,
          assignedAt: null,
        };
      return {
        socialAccountId: account.id,
        engineMessageId: input.engineMessageId,
        assignedTo: input.assigneeUserId,
        assignedToName: current?.display_name ?? null,
        assignedAt: current?.assigned_at ? current.assigned_at.toISOString() : null,
      };
    });
  }

  /**
   * Round 2 (sheet E-07): a person marks a message urgent, normal or low. Anyone who may reply for the account
   * may (the assigner holds `inbox.reply` too). There is no keyword guessing: a person decides, and who did it
   * and when is kept and audited. The due time is always counted from the time the message arrived, so a change
   * of priority moves the target, not the start.
   */
  async setPriority(access: Access, input: SetInboxPriorityRequest): Promise<InboxPriorityDto> {
    const inbox = this.inbox();
    const account = await this.tenant.run(ctxOf(access), async (trx) => {
      const row = await trx
        .selectFrom('social_accounts as a')
        .innerJoin('companies as c', 'c.id', 'a.company_id')
        .select([
          'a.id',
          'a.company_id',
          'a.engine_channel_id',
          'a.status',
          'c.group_id',
          'c.status as company_status',
        ])
        .where('a.id', '=', input.socialAccountId)
        .executeTakeFirst();
      if (!row) throw new NotFoundException('Social account not found.');
      if (!can(access, 'inbox.reply', { groupId: row.group_id, companyId: row.company_id }))
        throw new ForbiddenException('You cannot set the priority of messages for this account.');
      if (row.company_status !== 'active')
        throw new ConflictException(`The company is ${row.company_status}.`);
      if (row.status === 'archived') throw new ConflictException('This account is archived.');
      if (!row.engine_channel_id)
        throw new BadRequestException(
          'This account is not connected to the operational engine yet.',
        );
      return row;
    });
    const message = await this.findMessage(
      inbox,
      account.engine_channel_id!,
      input.engineMessageId,
    );
    if (!message) throw new NotFoundException('Message not found for this account.');

    return this.tenant.run(ctxOf(access), async (trx) => {
      const now = new Date();
      const existing = await trx
        .selectFrom('inbox_items')
        .select(['id', 'priority', 'received_at'])
        .where('social_account_id', '=', account.id)
        .where('engine_message_id', '=', input.engineMessageId)
        .forUpdate()
        .executeTakeFirst();
      const previous = existing?.priority ?? 'normal';
      const stamp = {
        priority: input.priority,
        priority_set_by: access.userId,
        priority_set_at: now,
        updated_at: now,
      };
      if (existing) {
        if (previous !== input.priority)
          await trx.updateTable('inbox_items').set(stamp).where('id', '=', existing.id).execute();
      } else {
        await trx
          .insertInto('inbox_items')
          .values({
            company_id: account.company_id,
            social_account_id: account.id,
            engine_message_id: input.engineMessageId,
            received_at: message.receivedAt,
            ...stamp,
          })
          .onConflict((oc) =>
            oc.columns(['social_account_id', 'engine_message_id']).doUpdateSet(stamp),
          )
          .execute();
      }
      const item = await trx
        .selectFrom('inbox_items as i')
        .leftJoin('users as u', 'u.id', 'i.priority_set_by')
        .select([
          'i.priority',
          'i.priority_set_by',
          'i.priority_set_at',
          'i.received_at',
          'u.display_name',
        ])
        .where('i.social_account_id', '=', account.id)
        .where('i.engine_message_id', '=', input.engineMessageId)
        .executeTakeFirstOrThrow();
      if (previous !== input.priority || !existing)
        await this.audit.record(trx, {
          action: AuditActions.inboxPrioritySet,
          actorUserId: access.userId,
          targetType: 'social_account',
          targetId: account.id,
          companyId: account.company_id,
          details: {
            engineMessageId: input.engineMessageId,
            from: previous,
            to: input.priority,
          },
        });
      const [calendar, targets] = await Promise.all([
        this.hours.calendarOf(trx, account.company_id),
        this.clock.targetsOf(trx, account.company_id),
      ]);
      const { targetMinutes, clock } = clockFor(item.priority, targets);
      const due = trackResponse({
        receivedAt: item.received_at,
        firstResponseAt: null,
        replied: false,
        targetMinutes,
        clock,
        calendar,
        now,
      }).dueAt!;
      return {
        socialAccountId: account.id,
        engineMessageId: input.engineMessageId,
        priority: item.priority,
        setBy: item.priority_set_by,
        setByName: item.display_name ?? null,
        setAt: item.priority_set_at ? item.priority_set_at.toISOString() : null,
        dueAt: due.toISOString(),
      };
    });
  }

  /** Users holding `inbox.reply` for the company (its own people and its group's). Ids only. */
  private replyHolders(trx: Transaction<DB>, companyId: string): Promise<string[]> {
    return this.clock.replyHolders(trx, companyId);
  }

  private async findMessage(
    inbox: InboxEngine,
    channelId: string,
    engineMessageId: string,
  ): Promise<InboxMessage | undefined> {
    const now = new Date();
    try {
      const found = await inbox.listInbox(
        { from: new Date(now.getTime() - REPLY_LOOKBACK_DAYS * DAY), to: now },
        channelId,
      );
      return found.find((m) => m.engineMessageId === engineMessageId);
    } catch {
      throw new BadGatewayException('The operational engine could not be reached.');
    }
  }

  async reply(access: Access, input: ReplyInboxRequest): Promise<{ sent: true }> {
    const inbox = this.inbox();
    const account = await this.tenant.run(ctxOf(access), async (trx) => {
      const row = await trx
        .selectFrom('social_accounts as a')
        .innerJoin('companies as c', 'c.id', 'a.company_id')
        .select([
          'a.id',
          'a.company_id',
          'a.engine_channel_id',
          'a.status',
          'c.group_id',
          'c.status as company_status',
        ])
        .where('a.id', '=', input.socialAccountId)
        .executeTakeFirst();
      if (!row) throw new NotFoundException('Social account not found.');
      if (!can(access, 'inbox.reply', { groupId: row.group_id, companyId: row.company_id }))
        throw new ForbiddenException('You cannot reply for this account.');
      if (row.company_status !== 'active')
        throw new ConflictException(`The company is ${row.company_status}.`);
      if (row.status === 'archived') throw new ConflictException('This account is archived.');
      if (!row.engine_channel_id)
        throw new BadRequestException(
          'This account is not connected to the operational engine yet.',
        );
      return row;
    });
    const channelId = account.engine_channel_id!;

    if (await this.freeze.isFrozen({ companyId: account.company_id, channelId }))
      throw new ForbiddenException('Publishing is frozen for this account. Replies are stopped.');

    // The message must belong to THIS account's channel: otherwise a person could answer a message
    // of another company by guessing its id.
    const message = await this.findMessage(inbox, channelId, input.engineMessageId);
    if (!message) throw new NotFoundException('Message not found for this account.');

    const record = (action: string, extra: Record<string, unknown> = {}) =>
      this.tenant.run(ctxOf(access), (trx) =>
        this.audit.record(trx, {
          action,
          actorUserId: access.userId,
          targetType: 'social_account',
          targetId: account.id,
          companyId: account.company_id,
          details: { engineMessageId: input.engineMessageId, kind: message.kind, ...extra },
        }),
      );

    await record(AuditActions.inboxReplyRequested, { text: input.text });
    try {
      await inbox.replyToMessage(input.engineMessageId, input.text);
    } catch (error) {
      await record(AuditActions.inboxReplyFailed, {
        error: error instanceof Error ? error.message : 'Unknown engine error.',
      });
      throw new BadGatewayException('The reply could not be sent. Nothing was posted.');
    }
    // The first reply sent through DCC ends the response time; a later reply never moves it.
    const repliedAt = new Date();
    await this.tenant.run(ctxOf(access), async (trx) => {
      await trx
        .insertInto('inbox_items')
        .values({
          company_id: account.company_id,
          social_account_id: account.id,
          engine_message_id: input.engineMessageId,
          received_at: message.receivedAt,
          first_response_at: repliedAt,
          first_response_by: access.userId,
        })
        .onConflict((oc) =>
          oc.columns(['social_account_id', 'engine_message_id']).doUpdateSet({
            first_response_at: sql<Date>`coalesce(inbox_items.first_response_at, excluded.first_response_at)`,
            first_response_by: sql<string>`coalesce(inbox_items.first_response_by, excluded.first_response_by)`,
            updated_at: repliedAt,
          }),
        )
        .execute();
      await this.audit.record(trx, {
        action: AuditActions.inboxReplySent,
        actorUserId: access.userId,
        targetType: 'social_account',
        targetId: account.id,
        companyId: account.company_id,
        details: { engineMessageId: input.engineMessageId, kind: message.kind },
      });
    });
    return { sent: true };
  }
}

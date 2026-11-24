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
  ROLES,
  ROLE_PERMISSIONS,
  type AssignInboxMessageRequest,
  type InboxAssigneeDto,
  type InboxAssignmentDto,
  type InboxMessageDto,
  type InboxQuery,
  type ReplyInboxRequest,
} from '@dcc/contracts';
import { sql, type Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';
import { FreezeService } from './freeze.service';
import { trackResponse } from './inbox-tracking';
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
    @Inject(OPERATIONAL_ENGINE) private readonly engine: OperationalEngine,
  ) {}

  private inbox(): InboxEngine {
    if (this.engine.capabilities().inbox !== true || !supportsInbox(this.engine))
      throw new NotImplementedException('The operational engine has no inbox yet.');
    return this.engine;
  }

  async list(access: Access, query: InboxQuery): Promise<InboxMessageDto[]> {
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
        .select(['id', 'company_id', 'engine_channel_id'])
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
            ])
            .where('social_account_id', 'in', accountIds)
            .where(
              'engine_message_id',
              'in',
              found.map((f) => f.message.engineMessageId),
            )
            .execute()
        : [];
      const targets = companyIds.length
        ? await trx
            .selectFrom('inbox_settings')
            .select(['company_id', 'response_target_minutes'])
            .where('company_id', 'in', companyIds)
            .execute()
        : [];
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
        targets: new Map(targets.map((t) => [t.company_id, t.response_target_minutes])),
        names: new Map(names.map((n) => [n.id, n.display_name])),
      };
    });

    const now = new Date();
    const messages: InboxMessageDto[] = [];
    for (const { account, message: m } of found) {
      const item = known.items.get(`${account.id}:${m.engineMessageId}`);
      const replied = m.replied || item?.first_response_at != null;
      const tracking = trackResponse({
        receivedAt: m.receivedAt,
        firstResponseAt: item?.first_response_at ?? null,
        replied,
        targetMinutes: known.targets.get(account.company_id) ?? null,
        now,
      });
      const dto: InboxMessageDto = {
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
        .select(['id', 'assigned_to'])
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
      if (existing) {
        if (previous !== input.assigneeUserId)
          await trx
            .updateTable('inbox_items')
            .set({ ...assignment, updated_at: now })
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
            })
            .execute();
        } catch (error) {
          // Two people assigned the same new message at the same moment: the second one retries.
          if ((error as { code?: string })?.code === '23505')
            throw new ConflictException('Someone else just changed this message. Try again.');
          throw error;
        }
      }
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
      const current = await trx
        .selectFrom('inbox_items as i')
        .innerJoin('users as u', 'u.id', 'i.assigned_to')
        .select(['i.assigned_at', 'u.display_name'])
        .where('i.social_account_id', '=', account.id)
        .where('i.engine_message_id', '=', input.engineMessageId)
        .executeTakeFirst();
      return {
        socialAccountId: account.id,
        engineMessageId: input.engineMessageId,
        assignedTo: input.assigneeUserId,
        assignedToName: current?.display_name ?? null,
        assignedAt: current?.assigned_at ? current.assigned_at.toISOString() : null,
      };
    });
  }

  /** Users holding `inbox.reply` for the company (its own people and its group's). Ids only. */
  private async replyHolders(trx: Transaction<DB>, companyId: string): Promise<string[]> {
    const roles = ROLES.filter((r) => ROLE_PERMISSIONS[r].includes('inbox.reply'));
    const { rows } = await sql<{
      user_id: string;
    }>`select user_id from notification_recipients(${companyId}::uuid, ${sql.val(roles)}::text[])`.execute(
      trx,
    );
    return rows.map((r) => r.user_id);
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

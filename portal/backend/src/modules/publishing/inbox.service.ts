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
import { supportsInbox, type InboxEngine, type OperationalEngine } from '@dcc/engine-client';
import type { InboxMessageDto, InboxQuery, ReplyInboxRequest } from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';
import { FreezeService } from './freeze.service';
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

    const messages: InboxMessageDto[] = [];
    for (const account of accounts) {
      let found;
      try {
        found = await inbox.listInbox({ from, to }, account.engine_channel_id!);
      } catch {
        throw new BadGatewayException('The operational engine could not be reached.');
      }
      for (const m of found)
        messages.push({
          engineMessageId: m.engineMessageId,
          socialAccountId: account.id,
          companyId: account.company_id,
          kind: m.kind,
          authorName: m.authorName,
          text: m.text,
          receivedAt: m.receivedAt.toISOString(),
          replied: m.replied,
        });
    }
    return messages.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
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
    const now = new Date();
    let message;
    try {
      const found = await inbox.listInbox(
        { from: new Date(now.getTime() - REPLY_LOOKBACK_DAYS * DAY), to: now },
        channelId,
      );
      message = found.find((m) => m.engineMessageId === input.engineMessageId);
    } catch {
      throw new BadGatewayException('The operational engine could not be reached.');
    }
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
    await record(AuditActions.inboxReplySent);
    return { sent: true };
  }
}

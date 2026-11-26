import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { supportsInbox, type OperationalEngine } from '@dcc/engine-client';
import type { AckSettingsDto, ApproveAckRequest, SetAckSettingsRequest } from '@dcc/contracts';
import type { Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { ctxOf, systemCheckContext } from '../shared/tenant-scope';
import { isWorkingInstant } from '../shared/working-time';
import { SweepService } from '../working-hours/sweep.service';
import { WorkingHoursService } from '../working-hours/working-hours.service';
import { FreezeService } from './freeze.service';
import { DAY_MS, hasEthiopic } from './inbox-replies-support';
import { OPERATIONAL_ENGINE } from './operational-engine.provider';

type Trx = Transaction<DB>;

/** The sweep looks at the messages of the last 7 days (the same window the inbox clock uses). */
const SWEEP_WINDOW_DAYS = 7;

const SETTINGS_COLUMNS = [
  'company_id',
  'text_en',
  'text_am',
  'enabled',
  'version',
  'set_by',
  'set_at',
  'approved_by',
  'approved_at',
] as const;

type SettingsRow = {
  company_id: string;
  text_en: string;
  text_am: string | null;
  enabled: boolean;
  version: number;
  set_by: string;
  set_at: Date;
  approved_by: string | null;
  approved_at: Date | null;
};

/**
 * Round 2, E-13 (RQ-033): the automatic acknowledgement of a message that arrives outside working hours.
 *
 * The text (English, plus an optional Amharic one) is written by a holder of `inbox.manage` and has NO effect until a
 * DIFFERENT person who holds `content.approve` approves exactly that version of it; any edit of a text clears the approval.
 * The sweep sends it, through the engine, as a reply to a message that arrived outside the company's working hours, has no
 * reply and no acknowledgement yet. It is NEVER the first response: it does not touch `inbox_items.first_response_at`, so
 * the response clock keeps running. It is sent once per message (a claim row, unique per message), never while the
 * company or the account is frozen, and the Amharic text only for a message that contains Ethiopic letters.
 *
 * ASSUMPTION: only messages that arrived after the approval are acknowledged (approving the text must not answer last week's
 * backlog), and both comments and direct messages are acknowledged.
 */
@Injectable()
export class InboxAckService implements OnModuleInit {
  private readonly log = new Logger('InboxAck');

  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
    private readonly hours: WorkingHoursService,
    private readonly sweep: SweepService,
    @Inject(OPERATIONAL_ENGINE) private readonly engine: OperationalEngine,
  ) {}

  onModuleInit(): void {
    this.sweep.register('inbox-acknowledgement', (companyId, now) => this.acknowledge(companyId, now));
  }

  // ---------------------------------------------------------------------------------------------------
  // Settings

  async get(access: Access, companyId: string): Promise<AckSettingsDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await this.companyOf(trx, companyId);
      if (!can(access, 'inbox.read', { groupId: company.group_id, companyId }))
        throw new ForbiddenException('You cannot read the inbox of this company.');
      return this.dto(trx, access, companyId, company.group_id);
    });
  }

  async set(access: Access, input: SetAckSettingsRequest): Promise<AckSettingsDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await this.companyOf(trx, input.companyId);
      if (!can(access, 'inbox.manage', { groupId: company.group_id, companyId: company.id }))
        throw new ForbiddenException('You cannot change the acknowledgement of this company.');
      const existing = await trx
        .selectFrom('inbox_ack_settings')
        .select(SETTINGS_COLUMNS)
        .where('company_id', '=', company.id)
        .forUpdate()
        .executeTakeFirst();
      const now = new Date();
      const textChanged =
        !existing || existing.text_en !== input.textEn || existing.text_am !== input.textAm;
      if (!existing) {
        await trx
          .insertInto('inbox_ack_settings')
          .values({
            company_id: company.id,
            text_en: input.textEn,
            text_am: input.textAm,
            enabled: input.enabled,
            set_by: access.userId,
            set_at: now,
          })
          .execute();
      } else if (textChanged) {
        // An edit of a text is a new version and clears the approval: the approver approved other words.
        await trx
          .updateTable('inbox_ack_settings')
          .set({
            text_en: input.textEn,
            text_am: input.textAm,
            enabled: input.enabled,
            version: existing.version + 1,
            set_by: access.userId,
            set_at: now,
            approved_by: null,
            approved_at: null,
          })
          .where('company_id', '=', company.id)
          .execute();
      } else if (existing.enabled !== input.enabled) {
        await trx
          .updateTable('inbox_ack_settings')
          .set({ enabled: input.enabled })
          .where('company_id', '=', company.id)
          .execute();
      }
      const result = await this.dto(trx, access, company.id, company.group_id);
      if (textChanged || existing?.enabled !== input.enabled)
        await this.audit.record(trx, {
          action: AuditActions.inboxAckSettingsSet,
          actorUserId: access.userId,
          targetType: 'company',
          targetId: company.id,
          companyId: company.id,
          details: {
            event: existing ? (textChanged ? 'edited' : 'switched') : 'created',
            version: result.version,
            enabled: input.enabled,
            approvalCleared: textChanged && existing?.approved_by != null,
            textEn: input.textEn,
            textAm: input.textAm,
          },
        });
      return result;
    });
  }

  async approve(access: Access, input: ApproveAckRequest): Promise<AckSettingsDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await this.companyOf(trx, input.companyId);
      if (!can(access, 'content.approve', { groupId: company.group_id, companyId: company.id }))
        throw new ForbiddenException('You cannot approve the acknowledgement of this company.');
      const row = await trx
        .selectFrom('inbox_ack_settings')
        .select(SETTINGS_COLUMNS)
        .where('company_id', '=', company.id)
        .forUpdate()
        .executeTakeFirst();
      if (!row) throw new NotFoundException('No acknowledgement text has been written yet.');
      if (row.set_by === access.userId)
        throw new ForbiddenException(
          'The person who wrote the acknowledgement cannot approve it. Ask another approver.',
        );
      if (row.version !== input.version)
        throw new ConflictException(
          'The text was edited after you opened it. Read it again before approving.',
        );
      if (row.approved_by) throw new ConflictException('This text is already approved.');
      await trx
        .updateTable('inbox_ack_settings')
        .set({ approved_by: access.userId, approved_at: new Date() })
        .where('company_id', '=', company.id)
        .execute();
      const result = await this.dto(trx, access, company.id, company.group_id);
      await this.audit.record(trx, {
        action: AuditActions.inboxAckSettingsSet,
        actorUserId: access.userId,
        targetType: 'company',
        targetId: company.id,
        companyId: company.id,
        details: { event: 'approved', version: row.version, writtenBy: row.set_by },
      });
      return result;
    });
  }

  private async companyOf(trx: Trx, companyId: string) {
    const company = await trx
      .selectFrom('companies')
      .select(['id', 'group_id'])
      .where('id', '=', companyId)
      .executeTakeFirst();
    // An unknown company and another company look the same.
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }

  private async dto(
    trx: Trx,
    access: Pick<Access, 'userId' | 'memberships'>,
    companyId: string,
    groupId: string,
  ): Promise<AckSettingsDto> {
    const row = await trx
      .selectFrom('inbox_ack_settings')
      .select(SETTINGS_COLUMNS)
      .where('company_id', '=', companyId)
      .executeTakeFirst();
    if (!row)
      return {
        companyId,
        textEn: null,
        textAm: null,
        enabled: false,
        version: 0,
        setBy: null,
        setByName: null,
        setAt: null,
        approvedBy: null,
        approvedByName: null,
        approvedAt: null,
        active: false,
        canApprove: false,
      };
    const ids = [row.set_by, ...(row.approved_by ? [row.approved_by] : [])];
    const names = new Map(
      (
        await trx.selectFrom('users').select(['id', 'display_name']).where('id', 'in', ids).execute()
      ).map((u) => [u.id, u.display_name]),
    );
    return {
      companyId,
      textEn: row.text_en,
      textAm: row.text_am,
      enabled: row.enabled,
      version: row.version,
      setBy: row.set_by,
      setByName: names.get(row.set_by) ?? null,
      setAt: row.set_at.toISOString(),
      approvedBy: row.approved_by,
      approvedByName: row.approved_by ? (names.get(row.approved_by) ?? null) : null,
      approvedAt: row.approved_at ? row.approved_at.toISOString() : null,
      active: row.enabled && row.approved_by !== null,
      canApprove:
        row.approved_by === null &&
        row.set_by !== access.userId &&
        can(access, 'content.approve', { groupId, companyId }),
    };
  }

  // ---------------------------------------------------------------------------------------------------
  // The sweep

  /**
   * One company, one pass. Reads the messages of the last 7 days through the engine and sends the approved text to every one
   * that arrived after the approval, outside working hours, with no reply and no acknowledgement yet.
   */
  async acknowledge(companyId: string, now: Date): Promise<void> {
    const ctx = systemCheckContext(companyId);
    const setup = await this.tenant.run(ctx, async (trx) => {
      const settings = await trx
        .selectFrom('inbox_ack_settings')
        .select(SETTINGS_COLUMNS)
        .where('company_id', '=', companyId)
        .executeTakeFirst();
      if (!settings || !settings.enabled || !settings.approved_by || !settings.approved_at)
        return null;
      const accounts = await trx
        .selectFrom('social_accounts')
        .select(['id', 'engine_channel_id'])
        .where('company_id', '=', companyId)
        .where('engine_channel_id', 'is not', null)
        .where('status', '<>', 'archived')
        .execute();
      return { settings, accounts, calendar: await this.hours.calendarOf(trx, companyId) };
    });
    if (!setup || setup.accounts.length === 0) return;
    const engine = this.engine;
    if (engine.capabilities().inbox !== true || !supportsInbox(engine)) return;
    const approvedAt = setup.settings.approved_at!;
    const from = new Date(Math.max(approvedAt.getTime(), now.getTime() - SWEEP_WINDOW_DAYS * DAY_MS));

    for (const account of setup.accounts) {
      const channelId = account.engine_channel_id!;
      // Never while the company or the account is frozen: an acknowledgement is public communication too.
      if (await this.freeze.isFrozen({ companyId, channelId })) continue;
      let messages;
      try {
        messages = await engine.listInbox({ from, to: now }, channelId);
      } catch {
        continue; // the engine is unreachable: the next sweep tries again
      }
      for (const m of messages) {
        if (m.replied || m.receivedAt < approvedAt || m.receivedAt > now) continue;
        if (isWorkingInstant(m.receivedAt, setup.calendar)) continue;
        const language = setup.settings.text_am && hasEthiopic(m.text) ? 'am' : 'en';
        const claimed = await this.claim(ctx, companyId, account.id, m, language);
        if (!claimed) continue;
        await this.send(ctx, companyId, account.id, m.engineMessageId, claimed.text, language, now);
      }
    }
  }

  /**
   * Takes the right to acknowledge ONE message: false when it already has an acknowledgement, a reply of ours, or when the
   * text is no longer approved. The claim is committed before the send, so two sweeps can never both send.
   */
  private async claim(
    ctx: ReturnType<typeof systemCheckContext>,
    companyId: string,
    accountId: string,
    m: { engineMessageId: string; receivedAt: Date },
    language: 'en' | 'am',
  ): Promise<{ text: string } | null> {
    return this.tenant.run(ctx, async (trx) => {
      const settings = await trx
        .selectFrom('inbox_ack_settings')
        .select(['text_en', 'text_am', 'enabled', 'approved_by'])
        .where('company_id', '=', companyId)
        .executeTakeFirst();
      if (!settings || !settings.enabled || !settings.approved_by) return null;
      const text = language === 'am' ? (settings.text_am ?? settings.text_en) : settings.text_en;
      const answered = await trx
        .selectFrom('inbox_items')
        .select('id')
        .where('social_account_id', '=', accountId)
        .where('engine_message_id', '=', m.engineMessageId)
        .where('first_response_at', 'is not', null)
        .executeTakeFirst();
      if (answered) return null;
      const inserted = await trx
        .insertInto('inbox_acknowledgements')
        .values({
          company_id: companyId,
          social_account_id: accountId,
          engine_message_id: m.engineMessageId,
          received_at: m.receivedAt,
          language: settings.text_am && language === 'am' ? 'am' : 'en',
        })
        .onConflict((oc) => oc.columns(['social_account_id', 'engine_message_id']).doNothing())
        .returning('id')
        .executeTakeFirst();
      return inserted ? { text } : null;
    });
  }

  private async send(
    ctx: ReturnType<typeof systemCheckContext>,
    companyId: string,
    accountId: string,
    engineMessageId: string,
    text: string,
    language: 'en' | 'am',
    now: Date,
  ): Promise<void> {
    const engine = this.engine;
    if (!supportsInbox(engine)) return;
    try {
      await engine.replyToMessage(engineMessageId, text);
    } catch (error) {
      // Release the claim so the next sweep tries again; nothing was sent. (Not audited: nothing happened.)
      await this.tenant.run(ctx, (trx) =>
        trx
          .deleteFrom('inbox_acknowledgements')
          .where('social_account_id', '=', accountId)
          .where('engine_message_id', '=', engineMessageId)
          .where('acked_at', 'is', null)
          .execute(),
      );
      this.log.warn(
        `Acknowledgement not sent: ${error instanceof Error ? error.message : 'unknown engine error'}`,
      );
      return;
    }
    // Recorded as acknowledged, and NOT as a response: inbox_items.first_response_at is left alone.
    await this.tenant.run(ctx, async (trx) => {
      await trx
        .updateTable('inbox_acknowledgements')
        .set({ acked_at: now })
        .where('social_account_id', '=', accountId)
        .where('engine_message_id', '=', engineMessageId)
        .execute();
      await this.audit.record(trx, {
        action: AuditActions.inboxAckSent,
        actorUserId: null,
        targetType: 'social_account',
        targetId: accountId,
        companyId,
        details: { engineMessageId, language, firstResponse: false },
      });
    });
  }
}

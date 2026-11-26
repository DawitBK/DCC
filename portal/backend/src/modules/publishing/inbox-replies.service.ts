import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { OperationalEngine } from '@dcc/engine-client';
import {
  REPLY_APPROVAL_LIMIT_MINUTES,
  REPLY_KIND_CATEGORY_KEY,
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type ApproveReplyRequest,
  type RejectReplyRequest,
  type ReplyApprovalDto,
  type ReplyApprovalQuery,
  type RequestReplyApprovalRequest,
  type Role,
} from '@dcc/contracts';
import { sql, type Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { ApprovalPolicyService } from '../approval-policy/approval-policy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { companyIdsWithPermission, ctxOf, NIL, systemCheckContext } from '../shared/tenant-scope';
import {
  APPROVAL_LADDER,
  dueAt,
  elapsedMinutes,
  escalationLevel,
} from '../shared/working-time';
import { SweepService } from '../working-hours/sweep.service';
import { WorkingHoursService } from '../working-hours/working-hours.service';
import { findMessage, inboxOf, loadAccountFor } from './inbox-replies-support';
import { FreezeService } from './freeze.service';
import { OPERATIONAL_ENGINE } from './operational-engine.provider';

type Trx = Transaction<DB>;

/** The people an escalation goes to when the approvers do not act: the Marketing & Communications Manager and senior management. */
export const ESCALATION_ROLES: readonly Role[] = ['company_executive', 'group_marketing'];

const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

const REQUEST_COLUMNS = [
  'id',
  'company_id',
  'social_account_id',
  'engine_message_id',
  'kind',
  'text',
  'written_by',
  'requested_at',
  'status',
  'required_approvals',
  'approver_roles',
  'category_key',
  'due_at',
  'settled_at',
  'settled_reason',
] as const;

type RequestRow = {
  id: string;
  company_id: string;
  social_account_id: string;
  engine_message_id: string;
  kind: ReplyApprovalDto['kind'];
  text: string;
  written_by: string;
  requested_at: Date;
  status: ReplyApprovalDto['status'];
  required_approvals: number;
  approver_roles: string[];
  category_key: string;
  due_at: Date;
  settled_at: Date | null;
  settled_reason: string | null;
};

/**
 * Round 2, E-08 (RQ-032): sensitive replies are approved before they are sent.
 *
 * A reply flagged sensitive is NOT sent: it becomes a pending request that stores the text, the message and the kind.
 * Holders of `content.approve` for the company, other than the writer, decide it; the number of different approvers is the
 * company's approval policy for the category the kind maps to (ASSUMPTION, see `REPLY_KIND_CATEGORY_KEY`). The last needed
 * approval sends the reply through the same engine path and the same checks as a normal reply, and keeps the
 * first-response bookkeeping of `inbox_items`. A refusal by the engine marks the request failed with the reason.
 * A request has 4 working hours (ASSUMPTION): the sweep reminds the approvers at 50%, the other holders at 100%, the
 * escalation roles at 150% and 200%. It never approves or sends anything by itself.
 */
@Injectable()
export class InboxRepliesService implements OnModuleInit {
  private readonly log = new Logger('ReplyApprovals');

  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
    private readonly notifications: NotificationsService,
    private readonly policies: ApprovalPolicyService,
    private readonly hours: WorkingHoursService,
    private readonly sweep: SweepService,
    @Inject(OPERATIONAL_ENGINE) private readonly engine: OperationalEngine,
  ) {}

  onModuleInit(): void {
    this.sweep.register('reply-approval-ladder', (companyId, now) =>
      this.escalate(companyId, now),
    );
  }

  // ---------------------------------------------------------------------------------------------------
  // Asking

  async request(access: Access, input: RequestReplyApprovalRequest): Promise<ReplyApprovalDto> {
    const inbox = inboxOf(this.engine);
    const account = await this.tenant.run(ctxOf(access), (trx) =>
      loadAccountFor(
        trx,
        access,
        input.socialAccountId,
        'inbox.reply',
        'You cannot reply for this account.',
      ),
    );
    if (await this.freeze.isFrozen({ companyId: account.company_id, channelId: account.engine_channel_id }))
      throw new ForbiddenException('Publishing is frozen for this account. Replies are stopped.');
    const message = await findMessage(inbox, account.engine_channel_id, input.engineMessageId);
    if (!message) throw new NotFoundException('Message not found for this account.');

    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const categoryKey = REPLY_KIND_CATEGORY_KEY[input.kind];
        const category = await trx
          .selectFrom('content_categories')
          .select('id')
          .where('group_id', '=', account.group_id)
          .where('key', '=', categoryKey)
          .where('status', '=', 'active')
          .executeTakeFirst();
        // No such category: the company's default policy, else one approver of any approving role (ASSUMPTION).
        const policy = await this.policies.effectivePolicy(
          trx,
          account.company_id,
          category?.id ?? null,
        );
        const now = new Date();
        const calendar = await this.hours.calendarOf(trx, account.company_id);
        const row = await trx
          .insertInto('reply_approval_requests')
          .values({
            company_id: account.company_id,
            social_account_id: account.id,
            engine_message_id: input.engineMessageId,
            kind: input.kind,
            text: input.text,
            written_by: access.userId,
            requested_at: now,
            required_approvals: policy.requiredApprovals,
            approver_roles: policy.approverRoles,
            category_key: categoryKey,
            due_at: dueAt(now, REPLY_APPROVAL_LIMIT_MINUTES, 'working', calendar),
          })
          .returning(REQUEST_COLUMNS)
          .executeTakeFirstOrThrow();

        await this.notifyApprovers(trx, row, {
          eventType: 'inbox.reply_requested',
          summary: `A sensitive reply on ${account.display_name} (${kindLabel(row.kind)}) waits for your approval.`,
          excludeUserIds: [access.userId],
        });
        const dto = (await this.toDto(trx, access, [row], new Map()))[0]!;
        await this.audit.record(trx, {
          action: AuditActions.replyApprovalRequested,
          actorUserId: access.userId,
          targetType: 'reply_approval_request',
          targetId: row.id,
          companyId: row.company_id,
          details: {
            socialAccountId: row.social_account_id,
            engineMessageId: row.engine_message_id,
            kind: row.kind,
            categoryKey,
            requiredApprovals: row.required_approvals,
            approverRoles: row.approver_roles,
          },
        });
        return dto;
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException(
          'A reply to this message is already waiting for approval or being sent.',
        );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------------------------------
  // Reading

  async list(access: Access, query: ReplyApprovalQuery): Promise<ReplyApprovalDto[]> {
    const dto = await this.tenant.run(ctxOf(access), async (trx) => {
      const readable = await companyIdsWithPermission(trx, access, 'inbox.read');
      const approvable = new Set(await companyIdsWithPermission(trx, access, 'content.approve'));
      const scope = query.companyId ? readable.filter((id) => id === query.companyId) : readable;
      let q = trx
        .selectFrom('reply_approval_requests')
        .select(REQUEST_COLUMNS)
        .where('company_id', 'in', scope.length ? scope : [NIL])
        .orderBy('requested_at', 'desc')
        .limit(200);
      if (query.status) q = q.where('status', '=', query.status);
      // An approver sees every request of the companies they approve for; anyone else sees only what they wrote.
      const visible = (await q.execute()).filter(
        (r) => approvable.has(r.company_id) || r.written_by === access.userId,
      );
      const messages = await this.messagesFor(trx, visible);
      return this.toDto(trx, access, visible, messages);
    });
    return query.forMe === 'true' ? dto.filter((d) => d.canDecide) : dto;
  }

  /** The message being answered, read live from the engine for the pending requests, so the approver sees what is answered. Best effort. */
  private async messagesFor(
    trx: Trx,
    rows: RequestRow[],
  ): Promise<Map<string, { author: string; text: string }>> {
    const found = new Map<string, { author: string; text: string }>();
    const pending = rows.filter((r) => r.status === 'pending');
    if (pending.length === 0) return found;
    let inbox;
    try {
      inbox = inboxOf(this.engine);
    } catch {
      return found;
    }
    const accounts = await trx
      .selectFrom('social_accounts')
      .select(['id', 'engine_channel_id'])
      .where('id', 'in', [...new Set(pending.map((r) => r.social_account_id))])
      .execute();
    for (const account of accounts) {
      if (!account.engine_channel_id) continue;
      for (const row of pending.filter((r) => r.social_account_id === account.id)) {
        try {
          const m = await findMessage(inbox, account.engine_channel_id, row.engine_message_id);
          if (m) found.set(row.id, { author: m.authorName, text: m.text });
        } catch {
          // The engine is unreachable: the approver sees the reply without the message. Nothing else is affected.
        }
      }
    }
    return found;
  }

  private async toDto(
    trx: Trx,
    access: Pick<Access, 'userId' | 'memberships'>,
    rows: RequestRow[],
    messages: Map<string, { author: string; text: string }>,
  ): Promise<ReplyApprovalDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const decisions = await trx
      .selectFrom('reply_approval_decisions')
      .select(['request_id', 'decided_by', 'decision', 'comment', 'decided_at'])
      .where('request_id', 'in', ids)
      .orderBy('decided_at', 'asc')
      .execute();
    const levels = await trx
      .selectFrom('escalation_events')
      .select(['target_id', (eb) => eb.fn.max('level').as('level')])
      .where('kind', '=', 'reply_approval')
      .where('target_id', 'in', ids)
      .groupBy('target_id')
      .execute();
    const companies = await trx
      .selectFrom('companies')
      .select(['id', 'group_id'])
      .where('id', 'in', [...new Set(rows.map((r) => r.company_id))])
      .execute();
    const groupOf = new Map(companies.map((c) => [c.id, c.group_id]));
    const userIds = [
      ...new Set([...rows.map((r) => r.written_by), ...decisions.map((d) => d.decided_by)]),
    ];
    const names = new Map(
      (
        await trx
          .selectFrom('users')
          .select(['id', 'display_name'])
          .where('id', 'in', userIds)
          .execute()
      ).map((u) => [u.id, u.display_name]),
    );
    const levelOf = new Map(levels.map((l) => [l.target_id, Number(l.level)]));
    return rows.map((r) => {
      const mine = decisions.filter((d) => d.request_id === r.id);
      const approvals = new Set(mine.filter((d) => d.decision === 'approved').map((d) => d.decided_by))
        .size;
      const groupId = groupOf.get(r.company_id);
      const canDecide =
        r.status === 'pending' &&
        groupId !== undefined &&
        r.written_by !== access.userId &&
        !mine.some((d) => d.decided_by === access.userId) &&
        can(access, 'content.approve', { groupId, companyId: r.company_id }) &&
        holdsApproverRole(access, r, groupId);
      const message = messages.get(r.id);
      return {
        id: r.id,
        companyId: r.company_id,
        socialAccountId: r.social_account_id,
        engineMessageId: r.engine_message_id,
        kind: r.kind,
        text: r.text,
        writtenBy: r.written_by,
        writtenByName: names.get(r.written_by) ?? null,
        status: r.status,
        requestedAt: r.requested_at.toISOString(),
        requiredApprovals: r.required_approvals,
        approvals,
        approverRoles: r.approver_roles,
        categoryKey: r.category_key,
        dueAt: r.due_at.toISOString(),
        escalationLevel: levelOf.get(r.id) ?? 0,
        settledAt: r.settled_at ? r.settled_at.toISOString() : null,
        settledReason: r.settled_reason,
        decisions: mine.map((d) => ({
          decidedBy: d.decided_by,
          decidedByName: names.get(d.decided_by) ?? null,
          decision: d.decision,
          comment: d.comment,
          decidedAt: d.decided_at.toISOString(),
        })),
        canDecide,
        messageAuthor: message?.author ?? null,
        messageText: message?.text ?? null,
      };
    });
  }

  // ---------------------------------------------------------------------------------------------------
  // Deciding

  /** Checks that apply to an approval AND to a rejection. Returns the row (locked when `lock`). */
  private async loadForDecision(
    trx: Trx,
    access: Access,
    id: string,
    lock: boolean,
  ): Promise<{ row: RequestRow; groupId: string }> {
    let q = trx.selectFrom('reply_approval_requests').select(REQUEST_COLUMNS).where('id', '=', id);
    if (lock) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    // Another company's request is invisible (row-level security): the same answer as an unknown id.
    if (!row) throw new NotFoundException('Reply approval request not found.');
    const company = await trx
      .selectFrom('companies')
      .select(['group_id', 'status'])
      .where('id', '=', row.company_id)
      .executeTakeFirstOrThrow();
    if (!can(access, 'content.approve', { groupId: company.group_id, companyId: row.company_id }))
      throw new ForbiddenException('You cannot approve replies for this company.');
    if (row.written_by === access.userId)
      throw new ForbiddenException('The person who wrote a reply cannot approve or reject it.');
    if (row.status !== 'pending')
      throw new ConflictException(`This request is already ${row.status}.`);
    if (!holdsApproverRole(access, row, company.group_id))
      throw new ForbiddenException(
        `The approval policy says this reply is decided by: ${row.approver_roles
          .map((r) => ROLE_LABELS[r as Role] ?? r)
          .join(', ')}.`,
      );
    return { row, groupId: company.group_id };
  }

  async approve(access: Access, id: string, input: ApproveReplyRequest): Promise<ReplyApprovalDto> {
    inboxOf(this.engine); // an engine with no inbox cannot send the reply: refuse before anything is recorded
    // Before anything is recorded: a frozen company or an unusable account refuses, and the request stays waiting.
    const account = await this.tenant.run(ctxOf(access), async (trx) => {
      const { row } = await this.loadForDecision(trx, access, id, false);
      const already = await trx
        .selectFrom('reply_approval_decisions')
        .select('id')
        .where('request_id', '=', id)
        .where('decided_by', '=', access.userId)
        .executeTakeFirst();
      if (already) throw new ConflictException('You have already decided this request.');
      return loadAccountFor(
        trx,
        access,
        row.social_account_id,
        'content.approve',
        'You cannot approve replies for this company.',
      );
    });
    if (await this.freeze.isFrozen({ companyId: account.company_id, channelId: account.engine_channel_id }))
      throw new ForbiddenException('Publishing is frozen for this account. Replies are stopped.');

    const ready: { row: RequestRow | null } = { row: null };
    try {
      await this.tenant.run(ctxOf(access), async (trx) => {
        const { row } = await this.loadForDecision(trx, access, id, true);
        await trx
          .insertInto('reply_approval_decisions')
          .values({
            request_id: id,
            company_id: row.company_id,
            decided_by: access.userId,
            decision: 'approved',
            comment: input.comment ?? null,
          })
          .execute();
        const counted = await trx
          .selectFrom('reply_approval_decisions')
          .select((eb) => eb.fn.count('decided_by').distinct().as('n'))
          .where('request_id', '=', id)
          .where('decision', '=', 'approved')
          .executeTakeFirstOrThrow();
        const approvals = Number(counted.n);
        const settled = approvals >= row.required_approvals;
        if (settled) {
          await trx
            .updateTable('reply_approval_requests')
            .set({ status: 'approved' })
            .where('id', '=', id)
            .execute();
          ready.row = row;
        }
        await this.audit.record(trx, {
          action: AuditActions.replyApprovalDecided,
          actorUserId: access.userId,
          targetType: 'reply_approval_request',
          targetId: id,
          companyId: row.company_id,
          details: {
            decision: 'approved',
            approvals,
            requiredApprovals: row.required_approvals,
            settled,
            engineMessageId: row.engine_message_id,
          },
        });
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('You have already decided this request.');
      throw error;
    }

    if (ready.row) await this.deliver(access, ready.row, account);
    return this.one(access, id);
  }

  async reject(access: Access, id: string, input: RejectReplyRequest): Promise<ReplyApprovalDto> {
    try {
      await this.tenant.run(ctxOf(access), async (trx) => {
        const { row } = await this.loadForDecision(trx, access, id, true);
        const now = new Date();
        await trx
          .insertInto('reply_approval_decisions')
          .values({
            request_id: id,
            company_id: row.company_id,
            decided_by: access.userId,
            decision: 'rejected',
            comment: input.reason,
          })
          .execute();
        await trx
          .updateTable('reply_approval_requests')
          .set({ status: 'rejected', settled_at: now, settled_reason: input.reason })
          .where('id', '=', id)
          .execute();
        await this.notifications.notifyUser(trx, {
          companyId: row.company_id,
          recipientUserId: row.written_by,
          eventType: 'inbox.reply_decided',
          targetType: 'reply_approval_request',
          targetId: id,
          summary: `Your sensitive reply was rejected: ${input.reason}`,
        });
        await this.audit.record(trx, {
          action: AuditActions.replyApprovalDecided,
          actorUserId: access.userId,
          targetType: 'reply_approval_request',
          targetId: id,
          companyId: row.company_id,
          details: {
            decision: 'rejected',
            reason: input.reason,
            engineMessageId: row.engine_message_id,
          },
        });
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('You have already decided this request.');
      throw error;
    }
    return this.one(access, id);
  }

  private async one(access: Access, id: string): Promise<ReplyApprovalDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const row = await trx
        .selectFrom('reply_approval_requests')
        .select(REQUEST_COLUMNS)
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return (await this.toDto(trx, access, [row], new Map()))[0]!;
    });
  }

  /**
   * The last approval has been recorded: send the reply through the engine with the same checks as a normal reply.
   * Audited before and after. A refusal marks the request failed with the reason and tells the writer; the approver gets the
   * refusal as the answer to their call.
   */
  private async deliver(
    access: Access,
    row: RequestRow,
    account: { id: string; company_id: string; engine_channel_id: string },
  ): Promise<void> {
    const inbox = inboxOf(this.engine);
    const fail = async (reason: string): Promise<never> => {
      await this.tenant.run(ctxOf(access), async (trx) => {
        await trx
          .updateTable('reply_approval_requests')
          .set({ status: 'failed', settled_at: new Date(), settled_reason: reason })
          .where('id', '=', row.id)
          .execute();
        await this.notifications.notifyUser(trx, {
          companyId: row.company_id,
          recipientUserId: row.written_by,
          eventType: 'inbox.reply_decided',
          targetType: 'reply_approval_request',
          targetId: row.id,
          summary: `Your sensitive reply was approved but could not be sent: ${reason}`,
        });
        await this.audit.record(trx, {
          action: AuditActions.inboxReplyFailed,
          actorUserId: access.userId,
          targetType: 'social_account',
          targetId: account.id,
          companyId: row.company_id,
          details: { replyApprovalId: row.id, engineMessageId: row.engine_message_id, error: reason },
        });
      });
      throw new BadGatewayException(
        `The reply was approved but could not be sent: ${reason} Nothing was posted.`,
      );
    };

    await this.tenant.run(ctxOf(access), (trx) =>
      this.audit.record(trx, {
        action: AuditActions.inboxReplyRequested,
        actorUserId: access.userId,
        targetType: 'social_account',
        targetId: account.id,
        companyId: row.company_id,
        details: {
          replyApprovalId: row.id,
          engineMessageId: row.engine_message_id,
          writtenBy: row.written_by,
        },
      }),
    );
    // The freeze can start between the approval and the send.
    if (await this.freeze.isFrozen({ companyId: account.company_id, channelId: account.engine_channel_id }))
      return fail('Publishing was frozen for this account.');
    let message;
    try {
      message = await findMessage(inbox, account.engine_channel_id, row.engine_message_id);
    } catch {
      return fail('The operational engine could not be reached.');
    }
    if (!message) return fail('The message is no longer available for this account.');
    try {
      await inbox.replyToMessage(row.engine_message_id, row.text);
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Unknown engine error.');
    }

    // The first reply sent through DCC ends the response time; a later reply never moves it. The writer answered.
    const repliedAt = new Date();
    await this.tenant.run(ctxOf(access), async (trx) => {
      await trx
        .insertInto('inbox_items')
        .values({
          company_id: row.company_id,
          social_account_id: account.id,
          engine_message_id: row.engine_message_id,
          received_at: message.receivedAt,
          first_response_at: repliedAt,
          first_response_by: row.written_by,
        })
        .onConflict((oc) =>
          oc.columns(['social_account_id', 'engine_message_id']).doUpdateSet({
            first_response_at: sql<Date>`coalesce(inbox_items.first_response_at, excluded.first_response_at)`,
            first_response_by: sql<string>`coalesce(inbox_items.first_response_by, excluded.first_response_by)`,
            updated_at: repliedAt,
          }),
        )
        .execute();
      await trx
        .updateTable('reply_approval_requests')
        .set({ status: 'sent', settled_at: repliedAt })
        .where('id', '=', row.id)
        .execute();
      await this.notifications.notifyUser(trx, {
        companyId: row.company_id,
        recipientUserId: row.written_by,
        eventType: 'inbox.reply_decided',
        targetType: 'reply_approval_request',
        targetId: row.id,
        summary: 'Your sensitive reply was approved and sent.',
      });
      await this.audit.record(trx, {
        action: AuditActions.inboxReplySent,
        actorUserId: access.userId,
        targetType: 'social_account',
        targetId: account.id,
        companyId: row.company_id,
        details: {
          replyApprovalId: row.id,
          engineMessageId: row.engine_message_id,
          kind: message.kind,
          writtenBy: row.written_by,
        },
      });
    });
  }

  // ---------------------------------------------------------------------------------------------------
  // The sweep: reminders, once per level

  /**
   * Level 1 (50% of the limit): the approvers who have not decided. Level 2 (100%): every holder of `content.approve` who
   * has not decided (the stand-ins). Levels 3 and 4 (150%, 200%): the escalation roles. Each level is recorded once in
   * `escalation_events`, so running the sweep twice tells nobody twice. Nothing is approved, rejected or sent.
   */
  async escalate(companyId: string, now: Date): Promise<void> {
    await this.tenant.run(systemCheckContext(companyId), async (trx) => {
      const pending = await trx
        .selectFrom('reply_approval_requests')
        .select(REQUEST_COLUMNS)
        .where('company_id', '=', companyId)
        .where('status', '=', 'pending')
        .execute();
      if (pending.length === 0) return;
      const calendar = await this.hours.calendarOf(trx, companyId);
      for (const row of pending) {
        const elapsed = elapsedMinutes(row.requested_at, now, 'working', calendar);
        const level = escalationLevel(elapsed, REPLY_APPROVAL_LIMIT_MINUTES, APPROVAL_LADDER);
        for (let step = 1; step <= level; step += 1) {
          const inserted = await trx
            .insertInto('escalation_events')
            .values({ company_id: companyId, kind: 'reply_approval', target_id: row.id, level: step })
            .onConflict((oc) => oc.columns(['kind', 'target_id', 'level']).doNothing())
            .returning('id')
            .executeTakeFirst();
          if (!inserted) continue;
          const told = await this.notifyLevel(trx, row, step);
          await this.audit.record(trx, {
            action: step === 1 ? AuditActions.approvalReminded : AuditActions.approvalEscalated,
            actorUserId: null,
            targetType: 'reply_approval_request',
            targetId: row.id,
            companyId,
            details: { kind: 'reply_approval', level: step, notified: told.length },
          });
        }
      }
    });
  }

  private async notifyLevel(trx: Trx, row: RequestRow, level: number): Promise<string[]> {
    const decided = (
      await trx
        .selectFrom('reply_approval_decisions')
        .select('decided_by')
        .where('request_id', '=', row.id)
        .execute()
    ).map((d) => d.decided_by);
    const exclude = [row.written_by, ...decided];
    const waiting = `A sensitive reply (${kindLabel(row.kind)}) has waited for approval`;
    if (level === 1)
      return this.notifyApprovers(trx, row, {
        eventType: 'approval.reminder',
        summary: `${waiting} for half of its time limit. Please decide it.`,
        excludeUserIds: exclude,
      });
    if (level === 2)
      return this.notifications.notifyRoles(trx, {
        companyId: row.company_id,
        roles: rolesHolding('content.approve'),
        eventType: 'approval.escalated',
        targetType: 'reply_approval_request',
        targetId: row.id,
        summary: `${waiting} past its time limit. Any approver may decide it.`,
        excludeUserIds: exclude,
      });
    return this.notifications.notifyRoles(trx, {
      companyId: row.company_id,
      roles: ESCALATION_ROLES,
      eventType: 'approval.escalated',
      targetType: 'reply_approval_request',
      targetId: row.id,
      summary:
        level === 3
          ? `${waiting} for one and a half times its time limit.`
          : `${waiting} for twice its time limit.`,
      excludeUserIds: [row.written_by],
    });
  }

  /** The people who may decide this request: the policy's roles when it names some, else every role that may approve content. */
  private notifyApprovers(
    trx: Trx,
    row: RequestRow,
    params: {
      eventType: 'inbox.reply_requested' | 'approval.reminder';
      summary: string;
      excludeUserIds: readonly string[];
    },
  ): Promise<string[]> {
    const holders = rolesHolding('content.approve');
    const roles = row.approver_roles.length
      ? holders.filter((r) => row.approver_roles.includes(r))
      : holders;
    return this.notifications.notifyRoles(trx, {
      companyId: row.company_id,
      roles,
      eventType: params.eventType,
      targetType: 'reply_approval_request',
      targetId: row.id,
      summary: params.summary,
      excludeUserIds: params.excludeUserIds,
    });
  }
}

const rolesHolding = (permission: 'content.approve'): Role[] =>
  ROLES.filter((r) => ROLE_PERMISSIONS[r].includes(permission));

/** The policy may narrow who decides. The caller's roles for THIS company count; a role elsewhere does not. */
function holdsApproverRole(
  access: Pick<Access, 'memberships'>,
  row: { company_id: string; approver_roles: string[] },
  groupId: string,
): boolean {
  if (row.approver_roles.length === 0) return true;
  return access.memberships.some(
    (m) =>
      (m.companyId === row.company_id || (m.companyId === null && m.groupId === groupId)) &&
      row.approver_roles.includes(m.role),
  );
}

const KIND_LABELS: Record<ReplyApprovalDto['kind'], string> = {
  legal_threat: 'legal threat',
  media: 'media',
  investor: 'investor',
  safety: 'safety',
  personal_data: 'personal data',
  refund_compensation: 'refund or compensation',
};
const kindLabel = (kind: ReplyApprovalDto['kind']) => KIND_LABELS[kind];

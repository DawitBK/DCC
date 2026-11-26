import { BadGatewayException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { supportsModeration, type OperationalEngine } from '@dcc/engine-client';
import type {
  HideMessageRequest,
  ModerationAction,
  ModerationActionDto,
  ModerationOutcome,
  ModerationQuery,
  RemoveMessageRequest,
} from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import type { Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';
import { findMessage, inboxOf, loadAccountFor } from './inbox-replies-support';
import { OPERATIONAL_ENGINE } from './operational-engine.provider';

const NOTES: Record<ModerationOutcome, Record<ModerationAction, string>> = {
  done: {
    hide: 'The comment was hidden in the network.',
    delete: 'The comment was deleted in the network.',
    block: 'The person was blocked in the network.',
  },
  recorded_only: {
    hide: 'Recorded, but the network was not changed. Hide it in the network\'s own inbox.',
    delete: 'Recorded, but the network was not changed. Delete it in the network\'s own inbox.',
    block: 'Recorded, but the network was not changed. Block the person in the network\'s own inbox.',
  },
  failed: {
    hide: 'The network refused to hide the comment. Nothing was changed.',
    delete: 'The network refused to delete the comment. Nothing was changed.',
    block: 'The network refused to block the person. Nothing was changed.',
  },
};

/**
 * Round 2, E-14 (RQ-033): moderation. Hide a comment needs `inbox.moderate` (Content Writer, Digital Marketing Manager);
 * delete a comment or block a user needs `inbox.remove` (Digital Marketing Manager only) and a written reason. Every action is
 * recorded (who, when, account, message, action, reason, outcome) and audited. The portal never calls the network itself: it
 * uses the engine's OPTIONAL moderation capability. An engine without it (the Postiz adapter today) gives the outcome
 * `recorded_only`, and the person is told in plain words that the network was not changed.
 */
@Injectable()
export class InboxModerationService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    @Inject(OPERATIONAL_ENGINE) private readonly engine: OperationalEngine,
  ) {}

  hide(access: Access, input: HideMessageRequest): Promise<ModerationActionDto> {
    return this.perform(access, 'hide', input.socialAccountId, input.engineMessageId, input.reason);
  }

  delete(access: Access, input: RemoveMessageRequest): Promise<ModerationActionDto> {
    return this.perform(
      access,
      'delete',
      input.socialAccountId,
      input.engineMessageId,
      input.reason,
    );
  }

  block(access: Access, input: RemoveMessageRequest): Promise<ModerationActionDto> {
    return this.perform(
      access,
      'block',
      input.socialAccountId,
      input.engineMessageId,
      input.reason,
    );
  }

  private async perform(
    access: Access,
    action: ModerationAction,
    socialAccountId: string,
    engineMessageId: string,
    reason: string | undefined,
  ): Promise<ModerationActionDto> {
    const inbox = inboxOf(this.engine);
    const permission = action === 'hide' ? 'inbox.moderate' : 'inbox.remove';
    const account = await this.tenant.run(ctxOf(access), (trx) =>
      loadAccountFor(
        trx,
        access,
        socialAccountId,
        permission,
        action === 'hide'
          ? 'You cannot hide comments for this account.'
          : 'Only the Digital Marketing Manager can delete comments or block people.',
      ),
    );
    // The message must belong to THIS account's channel.
    const message = await findMessage(inbox, account.engine_channel_id, engineMessageId);
    if (!message) throw new NotFoundException('Message not found for this account.');

    let outcome: ModerationOutcome;
    let detail: string | null = null;
    if (supportsModeration(this.engine)) {
      try {
        if (action === 'hide') await this.engine.hideMessage(engineMessageId);
        else if (action === 'delete') await this.engine.deleteMessage(engineMessageId);
        else await this.engine.blockAuthor(engineMessageId);
        outcome = 'done';
      } catch (error) {
        outcome = 'failed';
        detail = (error instanceof Error ? error.message : 'Unknown engine error.').slice(0, 500);
      }
    } else {
      outcome = 'recorded_only';
    }

    const dto = await this.tenant.run(ctxOf(access), async (trx) => {
      const row = await trx
        .insertInto('inbox_moderation_actions')
        .values({
          company_id: account.company_id,
          social_account_id: account.id,
          engine_message_id: engineMessageId,
          action,
          reason: reason && reason.length > 0 ? reason : null,
          outcome,
          outcome_detail: detail,
          performed_by: access.userId,
        })
        .returning(['id', 'performed_at'])
        .executeTakeFirstOrThrow();
      const who = await trx
        .selectFrom('users')
        .select('display_name')
        .where('id', '=', access.userId)
        .executeTakeFirst();
      await this.audit.record(trx, {
        action: AuditActions.inboxModerated,
        actorUserId: access.userId,
        targetType: 'social_account',
        targetId: account.id,
        companyId: account.company_id,
        details: {
          moderationActionId: row.id,
          engineMessageId,
          action,
          outcome,
          kind: message.kind,
          reason: reason && reason.length > 0 ? reason : null,
        },
      });
      return {
        id: row.id,
        companyId: account.company_id,
        socialAccountId: account.id,
        engineMessageId,
        action,
        reason: reason && reason.length > 0 ? reason : null,
        outcome,
        outcomeNote: NOTES[outcome][action],
        performedBy: access.userId,
        performedByName: who?.display_name ?? null,
        performedAt: row.performed_at.toISOString(),
      } satisfies ModerationActionDto;
    });
    // A refusal by the network is recorded first, then told: the attempt is on the record either way.
    if (outcome === 'failed') throw new BadGatewayException(NOTES.failed[action]);
    return dto;
  }

  /** The record of moderation actions in the companies where the caller may moderate, newest first. */
  async list(access: Access, query: ModerationQuery): Promise<ModerationActionDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'inbox.moderate');
      const scope = query.companyId ? companyIds.filter((id) => id === query.companyId) : companyIds;
      const rows = await trx
        .selectFrom('inbox_moderation_actions as a')
        .leftJoin('users as u', 'u.id', 'a.performed_by')
        .select([
          'a.id',
          'a.company_id',
          'a.social_account_id',
          'a.engine_message_id',
          'a.action',
          'a.reason',
          'a.outcome',
          'a.performed_by',
          'a.performed_at',
          'u.display_name',
        ])
        .where('a.company_id', 'in', scope.length ? scope : [NIL])
        .orderBy('a.performed_at', 'desc')
        .limit(200)
        .execute();
      return rows.map((r) => ({
        id: r.id,
        companyId: r.company_id,
        socialAccountId: r.social_account_id,
        engineMessageId: r.engine_message_id,
        action: r.action,
        reason: r.reason,
        outcome: r.outcome,
        outcomeNote: NOTES[r.outcome][r.action],
        performedBy: r.performed_by,
        performedByName: r.display_name,
        performedAt: r.performed_at.toISOString(),
      }));
    });
  }
}

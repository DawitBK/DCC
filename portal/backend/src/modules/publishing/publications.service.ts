import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GovernedEngine,
  GovernanceRefusedError,
  EngineOutcomeUnknownError,
  type OperationalEngine,
  type PublishRequest,
} from '@dcc/engine-client';
import type { PublicationDto, PublishContentRequest } from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { ContentApprovalVerifier } from '../content/approval-verifier';
import { DbIdempotencyStore } from './idempotency-store.service';
import { FreezeService } from './freeze.service';
import { OPERATIONAL_ENGINE } from './operational-engine.provider';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';

const PUBLICATION_COLUMNS = [
  'id',
  'company_id',
  'content_item_id',
  'content_version_id',
  'social_account_id',
  'requested_by',
  'approved_by',
  'engine_operation_id',
  'external_post_url',
  'status',
  'error',
  'requested_at',
  'completed_at',
] as const;

type PreparedPublish = {
  companyId: string;
  contentItemId: string;
  contentVersionId: string;
  socialAccountId: string;
  approverUserId: string | null;
  request: PublishRequest;
};

/**
 * H-05: the actual "publish" action. Loads what GovernedEngine needs to decide (never trusting the
 * engine or the caller beyond what is looked up here), calls it, then records the outcome as one
 * durable row per idempotency key - a double-click upserts the SAME row rather than creating two.
 */
@Injectable()
export class PublicationsService {
  private readonly engine: GovernedEngine;

  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    approvals: ContentApprovalVerifier,
    freeze: FreezeService,
    idempotency: DbIdempotencyStore,
    @Inject(OPERATIONAL_ENGINE) operationalEngine: OperationalEngine,
  ) {
    this.engine = new GovernedEngine(operationalEngine, approvals, freeze, idempotency);
  }

  async publish(
    access: Access,
    contentItemId: string,
    input: PublishContentRequest,
  ): Promise<PublicationDto> {
    const prepared = await this.prepare(access, contentItemId, input);

    try {
      const result = await this.engine.publish(prepared.request);
      return await this.record(access, prepared, {
        status: 'published',
        engineOperationId: result.engineOperationId,
        error: null,
        completedAt: new Date(),
      });
    } catch (error) {
      if (error instanceof GovernanceRefusedError) {
        if (error.reason === 'not_approved' || error.reason === 'frozen')
          throw new ForbiddenException(error.message);
        // 'in_progress' / 'outcome_unknown': a prior attempt already owns this key. Nothing new to
        // record - whichever attempt resolves it will update the one row that already exists.
        throw new ConflictException(error.message);
      }
      // The outcome genuinely could not be confirmed (timeout, 5xx): record it as still unresolved,
      // never as a silent success or a safe-to-retry failure. GovernedEngine has already marked the
      // idempotency key 'unknown', so a blind retry of the SAME request is refused until reconciled.
      const message = error instanceof Error ? error.message : 'Unknown engine error.';
      return await this.record(access, prepared, {
        status: error instanceof EngineOutcomeUnknownError ? 'pending' : 'failed',
        engineOperationId: null,
        error: message,
        completedAt: error instanceof EngineOutcomeUnknownError ? null : new Date(),
      });
    }
  }

  async list(access: Access): Promise<PublicationDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'content.read');
      const rows = await trx
        .selectFrom('publications')
        .select(PUBLICATION_COLUMNS)
        .where('company_id', 'in', companyIds.length ? companyIds : [NIL])
        .orderBy('requested_at', 'desc')
        .execute();
      return rows.map(toPublicationDto);
    });
  }

  private async prepare(
    access: Access,
    contentItemId: string,
    input: PublishContentRequest,
  ): Promise<PreparedPublish> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const item = await trx
        .selectFrom('content_items')
        .select(['id', 'company_id', 'current_version_id'])
        .where('id', '=', contentItemId)
        .executeTakeFirst();
      if (!item) throw new NotFoundException('Content item not found.');
      const company = await trx
        .selectFrom('companies')
        .select('group_id')
        .where('id', '=', item.company_id)
        .executeTakeFirstOrThrow();
      if (
        !can(access, 'content.publish', { groupId: company.group_id, companyId: item.company_id })
      )
        throw new ForbiddenException('You cannot publish this content item.');
      if (!item.current_version_id)
        throw new BadRequestException('This item has no version to publish.');

      const account = await trx
        .selectFrom('social_accounts')
        .select(['id', 'engine_channel_id'])
        .where('id', '=', input.socialAccountId)
        .where('company_id', '=', item.company_id)
        .executeTakeFirst();
      if (!account) throw new NotFoundException('Social account not found.');
      if (!account.engine_channel_id)
        throw new BadRequestException(
          'This account is not connected to the operational engine yet.',
        );

      const version = await trx
        .selectFrom('content_versions')
        .select(['id', 'version_number', 'body'])
        .where('id', '=', item.current_version_id)
        .executeTakeFirstOrThrow();

      const approval = await trx
        .selectFrom('approval_decisions as d')
        .innerJoin('approval_requests as r', 'r.id', 'd.approval_request_id')
        .select('d.decided_by')
        .where('r.content_version_id', '=', version.id)
        .where('d.decision', '=', 'approved')
        .orderBy('d.decided_at', 'desc')
        .executeTakeFirst();

      const idempotencyKey = `${contentItemId}:${version.version_number}:${account.engine_channel_id}`;
      return {
        companyId: item.company_id,
        contentItemId,
        contentVersionId: version.id,
        socialAccountId: account.id,
        approverUserId: approval?.decided_by ?? null,
        request: {
          idempotencyKey,
          dccContentId: contentItemId,
          approvalVersion: version.version_number,
          approverUserId: approval?.decided_by ?? access.userId,
          companyId: item.company_id,
          channelId: account.engine_channel_id,
          text: version.body,
          scheduledAt: null,
        },
      };
    });
  }

  private async record(
    access: Access,
    prepared: PreparedPublish,
    outcome: {
      status: 'pending' | 'published' | 'failed';
      engineOperationId: string | null;
      error: string | null;
      completedAt: Date | null;
    },
  ): Promise<PublicationDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const row = await trx
        .insertInto('publications')
        .values({
          company_id: prepared.companyId,
          content_item_id: prepared.contentItemId,
          content_version_id: prepared.contentVersionId,
          social_account_id: prepared.socialAccountId,
          requested_by: access.userId,
          approved_by: prepared.approverUserId,
          idempotency_key: prepared.request.idempotencyKey,
          engine_operation_id: outcome.engineOperationId,
          status: outcome.status,
          error: outcome.error,
          completed_at: outcome.completedAt,
        })
        .onConflict((oc) =>
          oc.column('idempotency_key').doUpdateSet({
            status: outcome.status,
            engine_operation_id: outcome.engineOperationId,
            error: outcome.error,
            completed_at: outcome.completedAt,
          }),
        )
        .returning(PUBLICATION_COLUMNS)
        .executeTakeFirstOrThrow();

      if (outcome.status !== 'pending') {
        await this.audit.record(trx, {
          action:
            outcome.status === 'published'
              ? AuditActions.publicationPublished
              : AuditActions.publicationFailed,
          actorUserId: access.userId,
          targetType: 'publication',
          targetId: row.id,
          companyId: prepared.companyId,
          details: {
            contentItemId: prepared.contentItemId,
            socialAccountId: prepared.socialAccountId,
            status: outcome.status,
          },
        });
      }
      return toPublicationDto(row);
    });
  }
}

const toPublicationDto = (r: {
  id: string;
  company_id: string;
  content_item_id: string;
  content_version_id: string;
  social_account_id: string;
  requested_by: string;
  approved_by: string | null;
  engine_operation_id: string | null;
  external_post_url: string | null;
  status: string;
  error: string | null;
  requested_at: Date;
  completed_at: Date | null;
}): PublicationDto => ({
  id: r.id,
  companyId: r.company_id,
  contentItemId: r.content_item_id,
  contentVersionId: r.content_version_id,
  socialAccountId: r.social_account_id,
  requestedBy: r.requested_by,
  approvedBy: r.approved_by,
  engineOperationId: r.engine_operation_id,
  externalPostUrl: r.external_post_url,
  status: r.status as PublicationDto['status'],
  error: r.error,
  requestedAt: r.requested_at.toISOString(),
  completedAt: r.completed_at ? r.completed_at.toISOString() : null,
});

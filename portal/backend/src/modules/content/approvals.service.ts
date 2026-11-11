import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ApprovalDecisionDto,
  ApprovalRequestDto,
  DecideApprovalRequest,
  ReviewContentRequest,
} from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import {
  assertDifferentPeople,
  can,
  SeparationOfDutiesError,
  type Access,
} from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';

const ctxOf = (a: Access) => ({ userId: a.userId, groupIds: a.groupIds, companyIds: a.companyIds });
const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

type Trx = Parameters<Parameters<TenantDb['run']>[1]>[0];

const REQUEST_COLUMNS = [
  'id',
  'content_version_id',
  'company_id',
  'requested_by',
  'requested_at',
  'status',
] as const;

/**
 * H-04 part 2: review and approve. The approval rule is the simple placeholder from the onboarding
 * task (step 7): one reviewer/approver who is not the creator, no category/level routing yet - that
 * is Abenezer's still-open A-05. Everything here is designed to be replaced without touching the
 * tables (see docs/api/content.md).
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async submit(access: Access, contentItemId: string): Promise<ApprovalRequestDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const item = await this.loadItemForRequest(trx, access, contentItemId, 'content.submit');
        if (!item.current_version_id)
          throw new BadRequestException('This item has no version to submit.');
        if (item.status !== 'draft' && item.status !== 'rejected')
          throw new ConflictException(`Cannot submit an item that is ${item.status}.`);

        const request = await trx
          .insertInto('approval_requests')
          .values({
            content_version_id: item.current_version_id,
            company_id: item.company_id,
            requested_by: access.userId,
          })
          .returning(REQUEST_COLUMNS)
          .executeTakeFirstOrThrow();

        await trx
          .updateTable('content_items')
          .set({ status: 'in_review', updated_at: new Date() })
          .where('id', '=', contentItemId)
          .execute();

        await this.audit.record(trx, {
          action: AuditActions.contentSubmitted,
          actorUserId: access.userId,
          targetType: 'content_item',
          targetId: contentItemId,
          companyId: item.company_id,
          details: { approvalRequestId: request.id, contentVersionId: item.current_version_id },
        });

        return toRequestDto(request, []);
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('This version already has an approval request.');
      throw error;
    }
  }

  async get(access: Access, contentItemId: string): Promise<ApprovalRequestDto | null> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const item = await this.loadItemForRequest(trx, access, contentItemId, 'content.read');
      if (!item.current_version_id) return null;
      const request = await trx
        .selectFrom('approval_requests')
        .select(REQUEST_COLUMNS)
        .where('content_version_id', '=', item.current_version_id)
        .executeTakeFirst();
      if (!request) return null;
      return toRequestDto(request, await this.decisionsOf(trx, request.id));
    });
  }

  async review(
    access: Access,
    approvalRequestId: string,
    input: ReviewContentRequest,
  ): Promise<ApprovalRequestDto> {
    return this.decide(
      access,
      approvalRequestId,
      'content.review',
      'commented',
      input.comment,
      null,
    );
  }

  async approve(
    access: Access,
    approvalRequestId: string,
    input: DecideApprovalRequest,
  ): Promise<ApprovalRequestDto> {
    return this.decide(
      access,
      approvalRequestId,
      'content.approve',
      'approved',
      input.comment ?? null,
      'approved',
    );
  }

  async reject(
    access: Access,
    approvalRequestId: string,
    input: DecideApprovalRequest,
  ): Promise<ApprovalRequestDto> {
    return this.decide(
      access,
      approvalRequestId,
      'content.approve',
      'rejected',
      input.comment ?? null,
      'rejected',
    );
  }

  private async decide(
    access: Access,
    approvalRequestId: string,
    permission: 'content.review' | 'content.approve',
    decision: 'commented' | 'approved' | 'rejected',
    comment: string | null,
    terminalStatus: 'approved' | 'rejected' | null,
  ): Promise<ApprovalRequestDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const { request, item } = await this.loadRequestWithItem(
          trx,
          access,
          approvalRequestId,
          permission,
        );
        if (request.status !== 'pending')
          throw new ConflictException(`This request is already ${request.status}.`);

        const row = await trx
          .insertInto('approval_decisions')
          .values({
            approval_request_id: approvalRequestId,
            company_id: request.company_id,
            decided_by: access.userId,
            decision,
            comment,
          })
          .returning(['id', 'decided_by', 'decision', 'comment', 'decided_at'])
          .executeTakeFirstOrThrow();

        let updatedRequest = request;
        if (terminalStatus) {
          updatedRequest = await trx
            .updateTable('approval_requests')
            .set({ status: terminalStatus })
            .where('id', '=', approvalRequestId)
            .returning(REQUEST_COLUMNS)
            .executeTakeFirstOrThrow();
          // Only move the item's status if this request's version is still the current one - an edit
          // since submission already reset the item to 'draft' (H-04 step 6: a new version needs a new
          // approval), and this decision is now just history for a superseded version.
          if (item.current_version_id === request.content_version_id) {
            await trx
              .updateTable('content_items')
              .set({ status: terminalStatus, updated_at: new Date() })
              .where('id', '=', item.id)
              .execute();
          }
        }

        await this.audit.record(trx, {
          action:
            decision === 'commented'
              ? AuditActions.contentReviewed
              : decision === 'approved'
                ? AuditActions.contentApproved
                : AuditActions.contentRejected,
          actorUserId: access.userId,
          targetType: 'content_item',
          targetId: item.id,
          companyId: request.company_id,
          details: { approvalRequestId, decisionId: row.id },
        });

        return toRequestDto(updatedRequest, await this.decisionsOf(trx, approvalRequestId));
      });
    } catch (error) {
      if (error instanceof SeparationOfDutiesError) throw new ForbiddenException(error.message);
      throw error;
    }
  }

  private async decisionsOf(trx: Trx, approvalRequestId: string): Promise<ApprovalDecisionDto[]> {
    const rows = await trx
      .selectFrom('approval_decisions')
      .select(['id', 'decided_by', 'decision', 'comment', 'decided_at'])
      .where('approval_request_id', '=', approvalRequestId)
      .orderBy('decided_at', 'asc')
      .execute();
    return rows.map(toDecisionDto);
  }

  /** Loads the item under the walls (RLS), 404s if hidden, then re-checks `permission` for its company. */
  private async loadItemForRequest(
    trx: Trx,
    access: Access,
    contentItemId: string,
    permission: 'content.submit' | 'content.read',
  ) {
    const item = await trx
      .selectFrom('content_items')
      .select(['id', 'company_id', 'created_by', 'current_version_id', 'status'])
      .where('id', '=', contentItemId)
      .executeTakeFirst();
    if (!item) throw new NotFoundException('Content item not found.');
    const company = await trx
      .selectFrom('companies')
      .select('group_id')
      .where('id', '=', item.company_id)
      .executeTakeFirstOrThrow();
    if (!can(access, permission, { groupId: company.group_id, companyId: item.company_id }))
      throw new ForbiddenException('You cannot act on this content item.');
    return item;
  }

  /** Loads the request (and its content item) under the walls, re-checks `permission`, and enforces
   * separation of duties: the creator can never review, approve or reject their own content. */
  private async loadRequestWithItem(
    trx: Trx,
    access: Access,
    approvalRequestId: string,
    permission: 'content.review' | 'content.approve',
  ) {
    const request = await trx
      .selectFrom('approval_requests')
      .select(REQUEST_COLUMNS)
      .where('id', '=', approvalRequestId)
      .executeTakeFirst();
    if (!request) throw new NotFoundException('Approval request not found.');
    const version = await trx
      .selectFrom('content_versions')
      .select('content_item_id')
      .where('id', '=', request.content_version_id)
      .executeTakeFirstOrThrow();
    const item = await trx
      .selectFrom('content_items')
      .select(['id', 'company_id', 'created_by', 'current_version_id'])
      .where('id', '=', version.content_item_id)
      .executeTakeFirstOrThrow();
    const company = await trx
      .selectFrom('companies')
      .select('group_id')
      .where('id', '=', item.company_id)
      .executeTakeFirstOrThrow();
    if (!can(access, permission, { groupId: company.group_id, companyId: item.company_id }))
      throw new ForbiddenException('You cannot act on this content item.');
    assertDifferentPeople(item.created_by, access.userId);
    return { request, item };
  }
}

const toDecisionDto = (r: {
  id: string;
  decided_by: string;
  decision: string;
  comment: string | null;
  decided_at: Date;
}): ApprovalDecisionDto => ({
  id: r.id,
  decidedBy: r.decided_by,
  decision: r.decision as ApprovalDecisionDto['decision'],
  comment: r.comment,
  decidedAt: r.decided_at.toISOString(),
});

const toRequestDto = (
  r: {
    id: string;
    content_version_id: string;
    company_id: string;
    requested_by: string;
    requested_at: Date;
    status: string;
  },
  decisions: ApprovalDecisionDto[],
): ApprovalRequestDto => ({
  id: r.id,
  contentVersionId: r.content_version_id,
  companyId: r.company_id,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at.toISOString(),
  status: r.status as ApprovalRequestDto['status'],
  decisions,
});

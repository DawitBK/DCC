import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ApprovalDecisionDto,
  ApprovalQueueItemDto,
  ApprovalRequestDto,
  DecideApprovalRequest,
  ReviewContentRequest,
} from '@dcc/contracts';
import { ROLE_LABELS, type Role } from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import {
  assertDifferentPeople,
  assertNotAnAuthor,
  can,
  SeparationOfDutiesError,
  type Access,
} from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { ApprovalPolicyService } from '../approval-policy/approval-policy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';

const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

type Trx = Parameters<Parameters<TenantDb['run']>[1]>[0];

const REQUEST_COLUMNS = [
  'id',
  'content_version_id',
  'company_id',
  'requested_by',
  'requested_at',
  'status',
  'required_approvals',
  'approver_roles',
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
    private readonly notifications: NotificationsService,
    private readonly policies: ApprovalPolicyService,
  ) {}

  async submit(access: Access, contentItemId: string): Promise<ApprovalRequestDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const item = await this.loadItemForRequest(trx, access, contentItemId, 'content.submit');
        if (!item.current_version_id)
          throw new BadRequestException('This item has no version to submit.');
        if (item.status !== 'draft' && item.status !== 'rejected')
          throw new ConflictException(`Cannot submit an item that is ${item.status}.`);

        // The rule is fixed now (H-09): a later change of the policy never changes a request that is waiting.
        const policy = await this.policies.effectivePolicy(trx, item.company_id, item.category_id);

        const request = await trx
          .insertInto('approval_requests')
          .values({
            content_version_id: item.current_version_id,
            company_id: item.company_id,
            requested_by: access.userId,
            required_approvals: policy.requiredApprovals,
            approver_roles: policy.approverRoles,
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
          details: {
            approvalRequestId: request.id,
            contentVersionId: item.current_version_id,
            requiredApprovals: policy.requiredApprovals,
            approverRoles: policy.approverRoles,
          },
        });

        await this.notifications.notifyHolders(trx, {
          companyId: item.company_id,
          groupId: item.group_id,
          permission: 'content.review',
          eventType: 'content.submitted',
          targetType: 'content_item',
          targetId: contentItemId,
          summary: 'Content was submitted for review.',
          excludeUserId: access.userId,
        });

        return toRequestDto(request, []);
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('This version already has an approval request.');
      throw error;
    }
  }

  /** The reviewers' queue: requests in every company where the caller may review or approve. */
  async list(
    access: Access,
    status: ApprovalQueueItemDto['status'],
  ): Promise<ApprovalQueueItemDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = [
        ...new Set([
          ...(await companyIdsWithPermission(trx, access, 'content.review')),
          ...(await companyIdsWithPermission(trx, access, 'content.approve')),
        ]),
      ];
      const rows = await trx
        .selectFrom('approval_requests as r')
        .innerJoin('content_versions as v', 'v.id', 'r.content_version_id')
        .select([
          'r.id',
          'v.content_item_id',
          'r.content_version_id',
          'r.company_id',
          'r.requested_by',
          'r.requested_at',
          'r.status',
          'r.required_approvals',
        ])
        .where('r.company_id', 'in', companyIds.length ? companyIds : [NIL])
        .where('r.status', '=', status)
        .orderBy('r.requested_at', 'asc')
        .limit(200)
        .execute();
      const counts = rows.length
        ? await trx
            .selectFrom('approval_decisions')
            .select(['approval_request_id', (eb) => eb.fn.count('decided_by').distinct().as('n')])
            .where(
              'approval_request_id',
              'in',
              rows.map((r) => r.id),
            )
            .where('decision', '=', 'approved')
            .groupBy('approval_request_id')
            .execute()
        : [];
      const approvalsOf = new Map(counts.map((c) => [c.approval_request_id, Number(c.n)]));
      return rows.map((r) => ({
        id: r.id,
        contentItemId: r.content_item_id,
        contentVersionId: r.content_version_id,
        companyId: r.company_id,
        requestedBy: r.requested_by,
        requestedAt: r.requested_at.toISOString(),
        status: r.status as ApprovalQueueItemDto['status'],
        requiredApprovals: r.required_approvals,
        approvals: approvalsOf.get(r.id) ?? 0,
      }));
    });
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

        if (decision !== 'commented') {
          // The policy may narrow who decides (H-09). The caller's roles for THIS company count: a role
          // in another company, or a group-level role of another group, does not.
          if (request.approver_roles.length > 0) {
            const mine = access.memberships
              .filter(
                (m) =>
                  m.companyId === request.company_id ||
                  (m.companyId === null && m.groupId === item.group_id),
              )
              .map((m) => m.role as string);
            if (!mine.some((r) => request.approver_roles.includes(r)))
              throw new ForbiddenException(
                `The approval policy says this content is decided by: ${request.approver_roles
                  .map((r) => ROLE_LABELS[r as Role] ?? r)
                  .join(', ')}.`,
              );
          }
          if (decision === 'approved') {
            const already = await trx
              .selectFrom('approval_decisions')
              .select('id')
              .where('approval_request_id', '=', approvalRequestId)
              .where('decided_by', '=', access.userId)
              .where('decision', '=', 'approved')
              .executeTakeFirst();
            if (already) throw new ConflictException('You have already approved this request.');
          }
        }

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

        // An approval settles the request only when enough DIFFERENT people have approved (H-09).
        let approvals = 0;
        let settled = terminalStatus;
        if (decision === 'approved') {
          const counted = await trx
            .selectFrom('approval_decisions')
            .select((eb) => eb.fn.count('decided_by').distinct().as('n'))
            .where('approval_request_id', '=', approvalRequestId)
            .where('decision', '=', 'approved')
            .executeTakeFirstOrThrow();
          approvals = Number(counted.n);
          if (approvals < request.required_approvals) settled = null;
        }

        let updatedRequest = request;
        if (settled) {
          updatedRequest = await trx
            .updateTable('approval_requests')
            .set({ status: settled })
            .where('id', '=', approvalRequestId)
            .returning(REQUEST_COLUMNS)
            .executeTakeFirstOrThrow();
          // Only move the item's status if this request's version is still the current one - an edit
          // since submission already reset the item to 'draft' (H-04 step 6: a new version needs a new
          // approval), and this decision is now just history for a superseded version.
          if (item.current_version_id === request.content_version_id) {
            await trx
              .updateTable('content_items')
              .set({ status: settled, updated_at: new Date() })
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
          details: {
            approvalRequestId,
            decisionId: row.id,
            ...(decision === 'approved'
              ? {
                  approvals,
                  requiredApprovals: request.required_approvals,
                  settled: settled !== null,
                }
              : {}),
          },
        });

        if (settled) {
          await this.notifications.notifyUser(trx, {
            companyId: request.company_id,
            recipientUserId: item.created_by,
            eventType: settled === 'approved' ? 'content.approved' : 'content.rejected',
            targetType: 'content_item',
            targetId: item.id,
            summary: `Content was ${settled}.`,
          });
        }

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
      .select(['id', 'company_id', 'created_by', 'current_version_id', 'category_id', 'status'])
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
    return { ...item, group_id: company.group_id };
  }

  /** Loads the request (and its content item) under the walls, re-checks `permission`, and enforces
   * separation of duties: nobody who wrote any version of the item (the first author or a later
   * editor) can review, approve or reject it. */
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
    // Every version's author counts, not only the first: whoever rewrote the text must not decide on it.
    const authors = await trx
      .selectFrom('content_versions')
      .select('created_by')
      .distinct()
      .where('content_item_id', '=', item.id)
      .execute();
    assertNotAnAuthor(
      authors.map((a) => a.created_by),
      access.userId,
    );
    return { request, item: { ...item, group_id: company.group_id } };
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
    required_approvals: number;
    approver_roles: string[];
  },
  decisions: ApprovalDecisionDto[],
): ApprovalRequestDto => ({
  id: r.id,
  contentVersionId: r.content_version_id,
  companyId: r.company_id,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at.toISOString(),
  status: r.status as ApprovalRequestDto['status'],
  requiredApprovals: r.required_approvals,
  approvals: new Set(decisions.filter((d) => d.decision === 'approved').map((d) => d.decidedBy))
    .size,
  approverRoles: r.approver_roles as Role[],
  decisions,
});

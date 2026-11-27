import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ApprovalDecisionDto,
  ApprovalQueueRowDto,
  ApprovalRequestFullDto,
  ApprovalState,
  ChangeContentCategoryRequest,
  ConfirmEmergencyRequest,
  DecideApprovalRequest,
  EmergencyApproveRequest,
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
import type { WorkingCalendar } from '../shared/working-time';
import { WorkingHoursService } from '../working-hours/working-hours.service';
import { ApprovalClockService } from './approval-clock.service';
import {
  APPROVER_ROLE_LIST,
  ESCALATION_ROLES,
  approvalIsPast,
  ruleFields,
  validUntilOf,
  type RuleRow,
} from './approval-state';

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
  'time_limit_hours',
  'clock',
  'escalation_level',
  'approved_at',
  'valid_until',
  'expired_at',
  'emergency',
  'emergency_by',
  'emergency_reason',
  'emergency_at',
  'emergency_confirmed_by',
  'emergency_confirmed_at',
] as const;

type RequestRow = {
  id: string;
  content_version_id: string;
  company_id: string;
  requested_by: string;
  status: string;
  required_approvals: number;
  approver_roles: string[];
} & RuleRow;

/** From this ladder level on, the request is open to every other holder of `content.approve` (the stand-in). */
const STAND_IN_LEVEL = 2;

/**
 * H-04 part 2 and Round 2: review, approve, the seven-day validity, the emergency post and the category change.
 * The approval rule (how many different people, which roles, which time limit) is data (approval policy), copied
 * onto the request when it is submitted, so a later change of the policy never moves a request that is waiting.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly policies: ApprovalPolicyService,
    private readonly clock: ApprovalClockService,
    private readonly working: WorkingHoursService,
  ) {}

  async submit(access: Access, contentItemId: string): Promise<ApprovalRequestFullDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const now = new Date();
        let item = await this.loadItemForRequest(trx, access, contentItemId, 'content.submit');
        const versionId = item.current_version_id;
        if (!versionId) throw new BadRequestException('This item has no version to submit.');
        // An approval nobody used within seven days is expired even if the sweep has not recorded it yet.
        const lapsed = await trx
          .selectFrom('approval_requests')
          .select('id')
          .where('content_version_id', '=', versionId)
          .where('status', '=', 'approved')
          .where('valid_until', '<', now)
          .executeTakeFirst();
        if (lapsed && (await this.clock.expireRequest(trx, lapsed.id, now)))
          item = await this.loadItemForRequest(trx, access, contentItemId, 'content.submit');
        if (item.status !== 'draft' && item.status !== 'rejected' && item.status !== 'expired')
          throw new ConflictException(`Cannot submit an item that is ${item.status}.`);

        // The rule is fixed now (H-09): a later change of the policy never changes a request that is waiting.
        const policy = await this.policies.effectivePolicy(trx, item.company_id, item.category_id);

        const request = await trx
          .insertInto('approval_requests')
          .values({
            content_version_id: versionId,
            company_id: item.company_id,
            requested_by: access.userId,
            required_approvals: policy.requiredApprovals,
            approver_roles: policy.approverRoles,
            time_limit_hours: policy.timeLimitHours,
            clock: policy.clock,
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
            contentVersionId: versionId,
            requiredApprovals: policy.requiredApprovals,
            approverRoles: policy.approverRoles,
            timeLimitHours: policy.timeLimitHours,
            clock: policy.clock,
            resubmittedAfterExpiry: lapsed !== undefined,
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

        return this.toDto(trx, request, [], now);
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('This version already has an approval request.');
      throw error;
    }
  }

  /** The reviewers' queue: requests in every company where the caller may review or approve. */
  async list(access: Access, status: ApprovalState): Promise<ApprovalQueueRowDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const now = new Date();
      const companyIds = [
        ...new Set([
          ...(await companyIdsWithPermission(trx, access, 'content.review')),
          ...(await companyIdsWithPermission(trx, access, 'content.approve')),
        ]),
      ];
      let query = trx
        .selectFrom('approval_requests as r')
        .innerJoin('content_versions as v', 'v.id', 'r.content_version_id')
        .innerJoin('content_items as i', 'i.id', 'v.content_item_id')
        .select([
          'r.id',
          'v.content_item_id',
          'r.content_version_id',
          'r.company_id',
          'r.requested_by',
          'r.requested_at',
          'r.status',
          'r.required_approvals',
          'r.time_limit_hours',
          'r.clock',
          'r.escalation_level',
          'r.approved_at',
          'r.valid_until',
          'r.emergency',
          'r.emergency_by',
          'r.emergency_reason',
          'r.emergency_at',
          'r.emergency_confirmed_by',
          'r.emergency_confirmed_at',
          'i.category_id',
        ])
        .where('r.company_id', 'in', companyIds.length ? companyIds : [NIL]);
      // An approval past its seven days counts as expired the moment it is read, before the sweep records it.
      if (status === 'approved')
        query = query
          .where('r.status', '=', 'approved')
          .where((eb) => eb.or([eb('r.valid_until', 'is', null), eb('r.valid_until', '>=', now)]));
      else if (status === 'expired')
        query = query.where((eb) =>
          eb.or([
            eb('r.status', '=', 'expired'),
            eb.and([eb('r.status', '=', 'approved'), eb('r.valid_until', '<', now)]),
          ]),
        );
      else query = query.where('r.status', '=', status);
      const rows = await query.orderBy('r.requested_at', 'asc').limit(200).execute();
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
      const calendars = new Map<string, WorkingCalendar>();
      const result: ApprovalQueueRowDto[] = [];
      for (const r of rows) {
        if (!calendars.has(r.company_id))
          calendars.set(r.company_id, await this.working.calendarOf(trx, r.company_id));
        const fields = ruleFields(r as unknown as RuleRow, calendars.get(r.company_id)!, now);
        result.push({
          id: r.id,
          contentItemId: r.content_item_id,
          contentVersionId: r.content_version_id,
          companyId: r.company_id,
          requestedBy: r.requested_by,
          requestedAt: r.requested_at.toISOString(),
          requiredApprovals: r.required_approvals,
          approvals: approvalsOf.get(r.id) ?? 0,
          categoryId: r.category_id,
          ...fields,
          status: fields.expired ? 'expired' : (r.status as ApprovalState),
        });
      }
      return result;
    });
  }

  async get(access: Access, contentItemId: string): Promise<ApprovalRequestFullDto | null> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const now = new Date();
      const item = await this.loadItemForRequest(trx, access, contentItemId, 'content.read');
      if (!item.current_version_id) return null;
      // A version can have several requests (an expired one, then a new one): the newest is the one that counts.
      let request = await trx
        .selectFrom('approval_requests')
        .select(REQUEST_COLUMNS)
        .where('content_version_id', '=', item.current_version_id)
        .orderBy('requested_at', 'desc')
        .executeTakeFirst();
      if (!request) return null;
      if (
        request.status === 'approved' &&
        approvalIsPast(request.valid_until, now) &&
        (await this.clock.expireRequest(trx, request.id, now))
      )
        request = await trx
          .selectFrom('approval_requests')
          .select(REQUEST_COLUMNS)
          .where('id', '=', request.id)
          .executeTakeFirstOrThrow();
      return this.toDto(trx, request, await this.decisionsOf(trx, request.id), now);
    });
  }

  async review(
    access: Access,
    approvalRequestId: string,
    input: ReviewContentRequest,
  ): Promise<ApprovalRequestFullDto> {
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
  ): Promise<ApprovalRequestFullDto> {
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
  ): Promise<ApprovalRequestFullDto> {
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
  ): Promise<ApprovalRequestFullDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const now = new Date();
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
          // in another company, or a group-level role of another group, does not. Once the request has
          // passed to the stand-in (escalation level 2) every other holder of the approve permission may decide.
          if (request.approver_roles.length > 0 && request.escalation_level < STAND_IN_LEVEL) {
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

        let updatedRequest: RequestRow = request;
        if (settled) {
          updatedRequest = await trx
            .updateTable('approval_requests')
            .set({
              status: settled,
              // The seven days run from the moment the request is settled as approved (C1-07).
              ...(settled === 'approved'
                ? { approved_at: now, valid_until: validUntilOf(now) }
                : {}),
            })
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
                  ...(settled === 'approved' && {
                    validUntil: validUntilOf(now).toISOString(),
                  }),
                  ...(request.escalation_level >= STAND_IN_LEVEL && { asStandIn: true }),
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

        return this.toDto(trx, updatedRequest, await this.decisionsOf(trx, approvalRequestId), now);
      });
    } catch (error) {
      if (error instanceof SeparationOfDutiesError) throw new ForbiddenException(error.message);
      throw error;
    }
  }

  /**
   * C1-14: a holder of `content.emergency_approve` settles a pending request as approved ALONE, with a written
   * reason. The separation of duties is unchanged (nobody who wrote any version). A second approval is owed.
   */
  async emergencyApprove(
    access: Access,
    approvalRequestId: string,
    input: EmergencyApproveRequest,
  ): Promise<ApprovalRequestFullDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const now = new Date();
        const { request, item } = await this.loadRequestWithItem(
          trx,
          access,
          approvalRequestId,
          'content.emergency_approve',
        );
        if (request.status !== 'pending')
          throw new ConflictException(`This request is already ${request.status}.`);
        if (item.current_version_id !== request.content_version_id)
          throw new ConflictException('This request is for an older version of the content.');

        await trx
          .insertInto('approval_decisions')
          .values({
            approval_request_id: approvalRequestId,
            company_id: request.company_id,
            decided_by: access.userId,
            decision: 'approved',
            comment: `Emergency approval: ${input.reason}`,
          })
          .execute();
        const updated = await trx
          .updateTable('approval_requests')
          .set({
            status: 'approved',
            approved_at: now,
            valid_until: validUntilOf(now),
            emergency: true,
            emergency_by: access.userId,
            emergency_reason: input.reason,
            emergency_at: now,
          })
          .where('id', '=', approvalRequestId)
          .returning(REQUEST_COLUMNS)
          .executeTakeFirstOrThrow();
        await trx
          .updateTable('content_items')
          .set({ status: 'approved', updated_at: now })
          .where('id', '=', item.id)
          .execute();

        const writers = new Set([item.created_by, request.requested_by]);
        writers.delete(access.userId);
        const summary =
          'A post was approved in an emergency by one person alone. A second approver must confirm within 24 hours.';
        const base = {
          companyId: request.company_id,
          targetType: 'content_item',
          targetId: item.id,
          summary,
        };
        await this.notifications.notifyRoles(trx, {
          ...base,
          roles: [...new Set([...APPROVER_ROLE_LIST, ...ESCALATION_ROLES])],
          eventType: 'approval.emergency',
          excludeUserIds: [access.userId, ...writers],
        });
        for (const userId of writers)
          await this.notifications.notifyUser(trx, {
            ...base,
            recipientUserId: userId,
            eventType: 'approval.emergency',
            summary:
              'Your content was approved in an emergency. A second approver must confirm it.',
          });

        await this.audit.record(trx, {
          action: AuditActions.approvalEmergency,
          actorUserId: access.userId,
          targetType: 'content_item',
          targetId: item.id,
          companyId: request.company_id,
          details: {
            approvalRequestId,
            reason: input.reason,
            requiredApprovals: request.required_approvals,
            validUntil: validUntilOf(now).toISOString(),
          },
        });
        return this.toDto(trx, updated, await this.decisionsOf(trx, approvalRequestId), now);
      });
    } catch (error) {
      if (error instanceof SeparationOfDutiesError) throw new ForbiddenException(error.message);
      throw error;
    }
  }

  /**
   * C1-14: the second approval owed after an emergency post. A DIFFERENT person who holds `content.approve`, who
   * wrote no version and is not the emergency approver. It may come after the 24 hours (that only escalates).
   */
  async confirmEmergency(
    access: Access,
    approvalRequestId: string,
    input: ConfirmEmergencyRequest,
  ): Promise<ApprovalRequestFullDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const now = new Date();
        const { request, item } = await this.loadRequestWithItem(
          trx,
          access,
          approvalRequestId,
          'content.approve',
        );
        if (!request.emergency)
          throw new ConflictException('This request was not approved in an emergency.');
        if (request.emergency_confirmed_at)
          throw new ConflictException('This emergency approval is already confirmed.');
        if (request.status === 'expired' || approvalIsPast(request.valid_until, now))
          throw new ConflictException(
            'The emergency approval has expired. Submit the content for approval again.',
          );
        if (request.status !== 'approved')
          throw new ConflictException(`This request is ${request.status}.`);
        // Even the platform owner cannot be both: the point is a second pair of eyes.
        if (request.emergency_by === access.userId)
          throw new ForbiddenException(
            'The person who gave the emergency approval cannot confirm it. A different approver must.',
          );

        await trx
          .insertInto('approval_decisions')
          .values({
            approval_request_id: approvalRequestId,
            company_id: request.company_id,
            decided_by: access.userId,
            decision: 'approved',
            comment: input.comment ?? 'Confirmed the emergency approval.',
          })
          .execute();
        const updated = await trx
          .updateTable('approval_requests')
          .set({ emergency_confirmed_by: access.userId, emergency_confirmed_at: now })
          .where('id', '=', approvalRequestId)
          .returning(REQUEST_COLUMNS)
          .executeTakeFirstOrThrow();

        for (const userId of new Set([
          request.emergency_by!,
          item.created_by,
          request.requested_by,
        ])) {
          if (userId === access.userId) continue;
          await this.notifications.notifyUser(trx, {
            companyId: request.company_id,
            recipientUserId: userId,
            eventType: 'content.approved',
            targetType: 'content_item',
            targetId: item.id,
            summary: 'The emergency approval was confirmed by a second approver.',
          });
        }
        await this.audit.record(trx, {
          action: AuditActions.approvalEmergencyConfirmed,
          actorUserId: access.userId,
          targetType: 'content_item',
          targetId: item.id,
          companyId: request.company_id,
          details: {
            approvalRequestId,
            emergencyBy: request.emergency_by,
            emergencyAt: request.emergency_at?.toISOString() ?? null,
            late: request.emergency_at
              ? now.getTime() - request.emergency_at.getTime() > 24 * 60 * 60 * 1000
              : false,
          },
        });
        return this.toDto(trx, updated, await this.decisionsOf(trx, approvalRequestId), now);
      });
    } catch (error) {
      if (error instanceof SeparationOfDutiesError) throw new ForbiddenException(error.message);
      throw error;
    }
  }

  /**
   * C1-08, RQ-034: a reviewer or manager changes the category of an item that is in review, only to a stricter
   * one. The pending request takes the new rule and keeps the decisions already made.
   */
  async changeCategory(
    access: Access,
    contentItemId: string,
    input: ChangeContentCategoryRequest,
  ): Promise<ApprovalRequestFullDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const now = new Date();
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
        const scope = { groupId: company.group_id, companyId: item.company_id };
        if (!can(access, 'content.review', scope) && !can(access, 'content.approve', scope))
          throw new ForbiddenException('You cannot change the category of this content item.');
        // The person who wrote any version never decides on the content, and the category decides how it is judged.
        if (!access.isPlatformOwner) await this.assertNotAnyAuthor(trx, item, access.userId);

        if (item.status !== 'in_review') {
          throw new ConflictException(
            item.status === 'approved' || item.status === 'published' || item.status === 'expired'
              ? 'An approved request cannot be recategorised: submit the content again with the right category.'
              : `The category can only be changed while the content is in review, and it is ${item.status}.`,
          );
        }
        const request = item.current_version_id
          ? await trx
              .selectFrom('approval_requests')
              .select(REQUEST_COLUMNS)
              .where('content_version_id', '=', item.current_version_id)
              .where('status', '=', 'pending')
              .executeTakeFirst()
          : undefined;
        if (!request)
          throw new ConflictException('There is no pending approval request to change.');

        const category = await trx
          .selectFrom('content_categories')
          .select(['id', 'group_id', 'status', 'name'])
          .where('id', '=', input.categoryId)
          .executeTakeFirst();
        if (!category || category.group_id !== company.group_id)
          throw new BadRequestException('That category does not exist.');
        if (category.status !== 'active')
          throw new BadRequestException('That category is archived.');
        if (item.category_id === category.id)
          throw new ConflictException('The content is already in that category.');

        const next = await this.policies.effectivePolicy(trx, item.company_id, category.id);
        // ASSUMPTION: "stricter" = the new category's rule needs at least as many different approvers as this request does.
        if (next.requiredApprovals < request.required_approvals)
          throw new ConflictException(
            `Only a stricter category can be chosen: ${category.name} needs ${next.requiredApprovals} approval${
              next.requiredApprovals === 1 ? '' : 's'
            } and this request already needs ${request.required_approvals}.`,
          );

        await trx
          .updateTable('content_items')
          .set({ category_id: category.id, updated_at: now })
          .where('id', '=', item.id)
          .execute();
        const updated = await trx
          .updateTable('approval_requests')
          .set({
            required_approvals: next.requiredApprovals,
            approver_roles: next.approverRoles,
            time_limit_hours: next.timeLimitHours,
            clock: next.clock,
          })
          .where('id', '=', request.id)
          .returning(REQUEST_COLUMNS)
          .executeTakeFirstOrThrow();

        await this.audit.record(trx, {
          action: AuditActions.contentCategoryChanged,
          actorUserId: access.userId,
          targetType: 'content_item',
          targetId: item.id,
          companyId: item.company_id,
          details: {
            approvalRequestId: request.id,
            reason: input.reason,
            from: {
              categoryId: item.category_id,
              requiredApprovals: request.required_approvals,
              approverRoles: request.approver_roles,
              timeLimitHours: request.time_limit_hours,
              clock: request.clock,
            },
            to: {
              categoryId: category.id,
              requiredApprovals: next.requiredApprovals,
              approverRoles: next.approverRoles,
              timeLimitHours: next.timeLimitHours,
              clock: next.clock,
            },
          },
        });
        return this.toDto(trx, updated, await this.decisionsOf(trx, request.id), now);
      });
    } catch (error) {
      if (error instanceof SeparationOfDutiesError) throw new ForbiddenException(error.message);
      throw error;
    }
  }

  private async toDto(
    trx: Trx,
    r: RequestRow,
    decisions: ApprovalDecisionDto[],
    now: Date,
  ): Promise<ApprovalRequestFullDto> {
    const fields = ruleFields(r, await this.working.calendarOf(trx, r.company_id), now);
    return {
      id: r.id,
      contentVersionId: r.content_version_id,
      companyId: r.company_id,
      requestedBy: r.requested_by,
      requestedAt: r.requested_at.toISOString(),
      requiredApprovals: r.required_approvals,
      approvals: new Set(decisions.filter((d) => d.decision === 'approved').map((d) => d.decidedBy))
        .size,
      approverRoles: r.approver_roles as Role[],
      decisions,
      ...fields,
      status: fields.expired ? 'expired' : (r.status as ApprovalState),
    };
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

  /** Nobody who wrote any version of the item (the first author or a later editor) may decide on it. */
  private async assertNotAnyAuthor(
    trx: Trx,
    item: { id: string; created_by: string },
    userId: string,
  ): Promise<void> {
    assertDifferentPeople(item.created_by, userId);
    const authors = await trx
      .selectFrom('content_versions')
      .select('created_by')
      .distinct()
      .where('content_item_id', '=', item.id)
      .execute();
    assertNotAnAuthor(
      authors.map((a) => a.created_by),
      userId,
    );
  }

  /** Loads the request (and its content item) under the walls, re-checks `permission`, and enforces
   * separation of duties: nobody who wrote any version of the item (the first author or a later
   * editor) can review, approve or reject it. */
  private async loadRequestWithItem(
    trx: Trx,
    access: Access,
    approvalRequestId: string,
    permission: 'content.review' | 'content.approve' | 'content.emergency_approve',
  ) {
    // Code review 2026-11-27: one decision at a time per request. Without this lock two approvers pressing Approve together
    // each counted only their own approval and a request with enough approvals stayed pending; a double click counted twice;
    // an emergency approval and a normal approval could both succeed. The second waits, then reads what the first committed.
    const request = await trx
      .selectFrom('approval_requests')
      .select(REQUEST_COLUMNS)
      .where('id', '=', approvalRequestId)
      .forUpdate()
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
    // The platform owner is not bound by the separation of duties; every decision is still audited.
    if (access.isPlatformOwner) return { request, item: { ...item, group_id: company.group_id } };
    await this.assertNotAnyAuthor(trx, item, access.userId);
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

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  APPROVER_ROLES,
  type ApprovalClock,
  type ApprovalPolicyFullDto,
  type ContentCategoryDto,
  type CreateContentCategoryRequest,
  type SetApprovalPolicyRequest,
  type UpdateContentCategoryRequest,
} from '@dcc/contracts';
import type { Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, scopesWith, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { ctxOf } from '../shared/tenant-scope';

const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

/** The rule a request is opened under. `approverRoles` empty = any role that may approve. */
export interface EffectivePolicy {
  requiredApprovals: number;
  approverRoles: string[];
  /** Round 2: the time limit in hours; null = no limit, so no clock. */
  timeLimitHours: number | null;
  /** Round 2: how the limit counts (office hours or round the clock). */
  clock: ApprovalClock;
}
export const DEFAULT_POLICY: EffectivePolicy = {
  requiredApprovals: 1,
  approverRoles: [],
  timeLimitHours: null,
  clock: 'working',
};

const CATEGORY_COLUMNS = ['id', 'group_id', 'key', 'name', 'status'] as const;
const POLICY_COLUMNS = [
  'id',
  'company_id',
  'category_id',
  'required_approvals',
  'approver_roles',
  'time_limit_hours',
  'clock',
  'updated_by',
  'updated_at',
] as const;

/**
 * H-09: who must approve what, as data an administrator changes on a screen.
 *  - categories are the Group's list; a group-level holder of `approval_policy.manage` maintains it;
 *  - a policy belongs to one company; whoever holds `approval_policy.manage` for that company sets it.
 * `effectivePolicy` is what the approval workflow asks when content is submitted.
 */
@Injectable()
export class ApprovalPolicyService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async listCategories(access: Access): Promise<ContentCategoryDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const rows = await trx
        .selectFrom('content_categories')
        .select(CATEGORY_COLUMNS)
        .orderBy('name')
        .execute();
      return rows.map(toCategory);
    });
  }

  async createCategory(
    access: Access,
    input: CreateContentCategoryRequest,
  ): Promise<ContentCategoryDto> {
    // The caller's own group, never a group id from the request (same as creating a company).
    const groupId = scopesWith(access, 'approval_policy.manage').groupIds[0];
    if (!groupId)
      throw new ForbiddenException('Only a group-level administrator can change the categories.');
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const row = await trx
          .insertInto('content_categories')
          .values({ group_id: groupId, key: input.key, name: input.name })
          .returning(CATEGORY_COLUMNS)
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, {
          action: AuditActions.contentCategoryCreated,
          actorUserId: access.userId,
          targetType: 'content_category',
          targetId: row.id,
          groupId: row.group_id,
          details: { key: row.key, name: row.name },
        });
        return toCategory(row);
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('A category with that key already exists.');
      throw error;
    }
  }

  async updateCategory(
    access: Access,
    id: string,
    input: UpdateContentCategoryRequest,
  ): Promise<ContentCategoryDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const current = await trx
        .selectFrom('content_categories')
        .select(CATEGORY_COLUMNS)
        .where('id', '=', id)
        .executeTakeFirst();
      if (!current) throw new NotFoundException('Category not found.');
      if (!can(access, 'approval_policy.manage', { groupId: current.group_id }))
        throw new ForbiddenException('Only a group-level administrator can change the categories.');
      const row = await trx
        .updateTable('content_categories')
        .set({ name: input.name ?? current.name, status: input.status ?? current.status })
        .where('id', '=', id)
        .returning(CATEGORY_COLUMNS)
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        action: AuditActions.contentCategoryUpdated,
        actorUserId: access.userId,
        targetType: 'content_category',
        targetId: id,
        groupId: current.group_id,
        details: {
          name: { from: current.name, to: row.name },
          status: { from: current.status, to: row.status },
        },
      });
      return toCategory(row);
    });
  }

  async listPolicies(access: Access, companyId?: string): Promise<ApprovalPolicyFullDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      let query = trx.selectFrom('approval_policies').select(POLICY_COLUMNS);
      if (companyId) query = query.where('company_id', '=', companyId);
      const rows = await query.orderBy('updated_at', 'desc').execute();
      return rows.map(toPolicy);
    });
  }

  /** Creates or replaces the policy of one company for one category (or its default, category null). */
  async setPolicy(access: Access, input: SetApprovalPolicyRequest): Promise<ApprovalPolicyFullDto> {
    const unknown = input.approverRoles.filter(
      (r) => !(APPROVER_ROLES as readonly string[]).includes(r),
    );
    if (unknown.length)
      throw new BadRequestException(`These roles cannot approve content: ${unknown.join(', ')}.`);
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await trx
        .selectFrom('companies')
        .select(['id', 'group_id'])
        .where('id', '=', input.companyId)
        .executeTakeFirst();
      if (!company) throw new NotFoundException('Company not found.');
      if (
        !can(access, 'approval_policy.manage', { groupId: company.group_id, companyId: company.id })
      )
        throw new ForbiddenException('You cannot change the approval policy of this company.');
      if (input.categoryId) {
        const category = await trx
          .selectFrom('content_categories')
          .select(['id', 'group_id', 'status'])
          .where('id', '=', input.categoryId)
          .executeTakeFirst();
        if (!category || category.group_id !== company.group_id)
          throw new BadRequestException('That category does not exist.');
      }

      const existing = await trx
        .selectFrom('approval_policies')
        .select(POLICY_COLUMNS)
        .where('company_id', '=', company.id)
        .where((eb) =>
          input.categoryId
            ? eb('category_id', '=', input.categoryId)
            : eb('category_id', 'is', null),
        )
        .executeTakeFirst();
      // Omitted time limit or clock keeps what the policy already has (a screen that does not know the new fields
      // must not wipe them); null clears the limit.
      const values = {
        required_approvals: input.requiredApprovals,
        approver_roles: input.approverRoles,
        time_limit_hours:
          input.timeLimitHours === undefined
            ? (existing?.time_limit_hours ?? null)
            : input.timeLimitHours,
        clock: input.clock ?? existing?.clock ?? 'working',
        updated_by: access.userId,
        updated_at: new Date(),
      };
      const row = existing
        ? await trx
            .updateTable('approval_policies')
            .set(values)
            .where('id', '=', existing.id)
            .returning(POLICY_COLUMNS)
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto('approval_policies')
            .values({ company_id: company.id, category_id: input.categoryId ?? null, ...values })
            .returning(POLICY_COLUMNS)
            .executeTakeFirstOrThrow();

      await this.audit.record(trx, {
        action: AuditActions.approvalPolicySet,
        actorUserId: access.userId,
        targetType: 'approval_policy',
        targetId: row.id,
        companyId: company.id,
        details: {
          categoryId: row.category_id,
          from: existing
            ? {
                requiredApprovals: existing.required_approvals,
                approverRoles: existing.approver_roles,
                timeLimitHours: existing.time_limit_hours,
                clock: existing.clock,
              }
            : null,
          to: {
            requiredApprovals: row.required_approvals,
            approverRoles: row.approver_roles,
            timeLimitHours: row.time_limit_hours,
            clock: row.clock,
          },
        },
      });
      return toPolicy(row);
    });
  }

  async removePolicy(access: Access, id: string): Promise<void> {
    await this.tenant.run(ctxOf(access), async (trx) => {
      const policy = await trx
        .selectFrom('approval_policies')
        .select(POLICY_COLUMNS)
        .where('id', '=', id)
        .executeTakeFirst();
      if (!policy) throw new NotFoundException('Policy not found.');
      const company = await trx
        .selectFrom('companies')
        .select('group_id')
        .where('id', '=', policy.company_id)
        .executeTakeFirstOrThrow();
      if (
        !can(access, 'approval_policy.manage', {
          groupId: company.group_id,
          companyId: policy.company_id,
        })
      )
        throw new ForbiddenException('You cannot change the approval policy of this company.');
      await trx.deleteFrom('approval_policies').where('id', '=', id).execute();
      await this.audit.record(trx, {
        action: AuditActions.approvalPolicyRemoved,
        actorUserId: access.userId,
        targetType: 'approval_policy',
        targetId: id,
        companyId: policy.company_id,
        details: {
          categoryId: policy.category_id,
          requiredApprovals: policy.required_approvals,
          approverRoles: policy.approver_roles,
          timeLimitHours: policy.time_limit_hours,
          clock: policy.clock,
        },
      });
    });
  }

  /**
   * The rule for a piece of content at the moment it is submitted: the company's policy for the
   * item's category, else the company's default policy, else one approver of any approving role.
   * Runs inside the caller's transaction (the approval workflow's).
   */
  async effectivePolicy(
    trx: Transaction<DB>,
    companyId: string,
    categoryId: string | null,
  ): Promise<EffectivePolicy> {
    const rows = await trx
      .selectFrom('approval_policies')
      .select(['category_id', 'required_approvals', 'approver_roles', 'time_limit_hours', 'clock'])
      .where('company_id', '=', companyId)
      .where((eb) =>
        categoryId
          ? eb.or([eb('category_id', '=', categoryId), eb('category_id', 'is', null)])
          : eb('category_id', 'is', null),
      )
      .execute();
    const chosen = rows.find((r) => r.category_id !== null) ?? rows[0];
    return chosen
      ? {
          requiredApprovals: chosen.required_approvals,
          approverRoles: chosen.approver_roles,
          timeLimitHours: chosen.time_limit_hours,
          clock: chosen.clock,
        }
      : DEFAULT_POLICY;
  }
}

const toCategory = (r: {
  id: string;
  group_id: string;
  key: string;
  name: string;
  status: string;
}): ContentCategoryDto => ({
  id: r.id,
  groupId: r.group_id,
  key: r.key,
  name: r.name,
  status: r.status as ContentCategoryDto['status'],
});

const toPolicy = (r: {
  id: string;
  company_id: string;
  category_id: string | null;
  required_approvals: number;
  approver_roles: string[];
  time_limit_hours: number | null;
  clock: 'working' | 'continuous';
  updated_by: string;
  updated_at: Date;
}): ApprovalPolicyFullDto => ({
  id: r.id,
  companyId: r.company_id,
  categoryId: r.category_id,
  requiredApprovals: r.required_approvals,
  approverRoles: r.approver_roles as ApprovalPolicyFullDto['approverRoles'],
  timeLimitHours: r.time_limit_hours,
  clock: r.clock,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at.toISOString(),
});

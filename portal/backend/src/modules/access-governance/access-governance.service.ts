import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  roleAllowedAtScope,
  type GrantMembershipRequest,
  type MembershipRecordDto,
  type Role,
  type UserDto,
} from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, scopesWith, type Access } from '../../platform/authz/authz';
import { ctxOf } from '../shared/tenant-scope';
import { TenantDb } from '../../platform/tenancy/tenant-db';

const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';
const foreignKeyViolation = (e: unknown) => (e as { code?: string })?.code === '23503';

/**
 * H-03: people and roles. "List people the caller may see" leans entirely on the users_select /
 * memberships_select RLS policies (platform foundation); this service adds grant/revoke on top,
 * following the same pattern as every other module: TenantDb.run, authz.can re-checked for the
 * specific scope, an audit event in the same transaction, last.
 *
 * Role-grant scope (confirmed with Dawit, H-03 step 4): a company administrator may grant/revoke any
 * COMPANY-scoped role - including another company_admin - inside their own company only, and never a
 * group-level role. Only someone who already holds a group-level permission can grant a group-level
 * role. This is enforced twice: here (roleAllowedAtScope + authz.can) and independently by the database
 * (RLS + the membership_role_scope check constraint) - see test/tenant-isolation.test.ts.
 */
@Injectable()
export class AccessGovernanceService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async listUsers(access: Access): Promise<UserDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const users = await trx
        .selectFrom('users')
        .select(['id', 'email', 'display_name', 'status'])
        .orderBy('email')
        .execute();
      const userIds = users.map((u) => u.id);
      const memberships = userIds.length
        ? await trx
            .selectFrom('memberships')
            .select(['id', 'user_id', 'role', 'company_id', 'group_id', 'source'])
            .where('user_id', 'in', userIds)
            .execute()
        : [];
      const byUser = new Map<string, MembershipRecordDto[]>();
      for (const m of memberships) {
        const list = byUser.get(m.user_id) ?? [];
        list.push({
          id: m.id,
          role: m.role as Role,
          companyId: m.company_id,
          groupId: m.group_id,
          source: m.source as MembershipRecordDto['source'],
        });
        byUser.set(m.user_id, list);
      }
      return users.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        status: u.status as UserDto['status'],
        memberships: byUser.get(u.id) ?? [],
      }));
    });
  }

  async grant(access: Access, input: GrantMembershipRequest): Promise<MembershipRecordDto> {
    // Self-grant is never allowed, even inside a scope the caller already manages (H-03 attack test:
    // "cannot grant themselves more"). RLS and authz.can alone would not catch this - both would
    // happily permit a company_admin to grant themselves another company role in their own company.
    if (input.userId === access.userId)
      throw new ForbiddenException('You cannot grant yourself a role.');

    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        let groupId: string;
        let companyId: string | null = null;

        if (input.companyId) {
          const company = await trx
            .selectFrom('companies')
            .select(['id', 'group_id'])
            .where('id', '=', input.companyId)
            .executeTakeFirst();
          // RLS hides a company the caller cannot see; "not found" and "not yours" look identical.
          if (!company) throw new NotFoundException('Company not found.');
          groupId = company.group_id;
          companyId = company.id;
        } else {
          // Mirrors CompaniesService.create: the caller's own group, never a group id from the body.
          const callerGroupId = scopesWith(access, 'user.manage').groupIds[0];
          if (!callerGroupId)
            throw new ForbiddenException(
              'Only a group-level administrator can grant a group-level role.',
            );
          groupId = callerGroupId;
        }

        if (!roleAllowedAtScope(input.role, companyId ? 'company' : 'group'))
          throw new BadRequestException(
            `${input.role} cannot be held at ${companyId ? 'company' : 'group'} scope.`,
          );
        if (!can(access, 'user.manage', companyId ? { groupId, companyId } : { groupId }))
          throw new ForbiddenException('You cannot manage access for this scope.');

        const row = await trx
          .insertInto('memberships')
          .values({
            user_id: input.userId,
            group_id: groupId,
            company_id: companyId,
            role: input.role,
            created_by: access.userId,
          })
          .returning(['id', 'user_id', 'role', 'company_id', 'group_id', 'source'])
          .executeTakeFirstOrThrow();

        await this.audit.record(trx, {
          action: AuditActions.membershipGranted,
          actorUserId: access.userId,
          targetType: 'membership',
          targetId: row.id,
          companyId,
          details: { userId: row.user_id, role: row.role },
        });
        return {
          id: row.id,
          role: row.role as Role,
          companyId: row.company_id,
          groupId: row.group_id,
          source: row.source as MembershipRecordDto['source'],
        };
      });
    } catch (error) {
      if (uniqueViolation(error)) throw new ConflictException('That role is already granted.');
      if (foreignKeyViolation(error)) throw new BadRequestException('That person does not exist.');
      throw error;
    }
  }

  async revoke(access: Access, membershipId: string): Promise<void> {
    await this.tenant.run(ctxOf(access), async (trx) => {
      const membership = await trx
        .selectFrom('memberships')
        .select(['id', 'user_id', 'role', 'company_id', 'group_id'])
        .where('id', '=', membershipId)
        .executeTakeFirst();
      if (!membership) throw new NotFoundException('Membership not found.');
      if (
        !can(
          access,
          'user.manage',
          membership.company_id
            ? { groupId: membership.group_id, companyId: membership.company_id }
            : { groupId: membership.group_id },
        )
      )
        throw new ForbiddenException('You cannot manage access for this scope.');

      const result = await trx
        .deleteFrom('memberships')
        .where('id', '=', membershipId)
        .executeTakeFirst();
      if (Number(result.numDeletedRows) === 0) throw new NotFoundException('Membership not found.');

      await this.audit.record(trx, {
        action: AuditActions.membershipRevoked,
        actorUserId: access.userId,
        targetType: 'membership',
        targetId: membershipId,
        companyId: membership.company_id,
        details: { userId: membership.user_id, role: membership.role },
      });
    });
  }
}

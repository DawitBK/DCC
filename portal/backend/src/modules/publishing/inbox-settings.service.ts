import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { InboxSettingsDto, SetInboxSettingsRequest } from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';

/**
 * H-14: the per-company response-time target of the inbox. There is no default: a company with no row, or a
 * row with a null target, has no target and nothing is ever overdue. The numbers come from the marketing lead
 * (A-07). Managing it needs `approval_policy.manage` for the company, the same gate as the other per-company
 * rules an administrator maintains (a dedicated permission can replace it later without changing this contract).
 */
@Injectable()
export class InboxSettingsService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
  ) {}

  /** One entry per company the caller may read the inbox of, with or without a target. */
  async list(access: Access): Promise<InboxSettingsDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'inbox.read');
      const rows = await trx
        .selectFrom('companies as c')
        .leftJoin('inbox_settings as s', 's.company_id', 'c.id')
        .select(['c.id as companyId', 's.response_target_minutes', 's.updated_at'])
        .where('c.id', 'in', companyIds.length ? companyIds : [NIL])
        .orderBy('c.name')
        .execute();
      return rows.map((r) => ({
        companyId: r.companyId,
        responseTargetMinutes: r.response_target_minutes ?? null,
        updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
      }));
    });
  }

  async set(access: Access, input: SetInboxSettingsRequest): Promise<InboxSettingsDto> {
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
        throw new ForbiddenException('You cannot change the inbox settings of this company.');
      const existing = await trx
        .selectFrom('inbox_settings')
        .select(['response_target_minutes', 'updated_at'])
        .where('company_id', '=', company.id)
        .forUpdate()
        .executeTakeFirst();
      const previous = existing?.response_target_minutes ?? null;
      if (existing && previous === input.responseTargetMinutes)
        return {
          companyId: company.id,
          responseTargetMinutes: previous,
          updatedAt: existing.updated_at.toISOString(),
        };
      const now = new Date();
      const row = await trx
        .insertInto('inbox_settings')
        .values({
          company_id: company.id,
          response_target_minutes: input.responseTargetMinutes,
          updated_by: access.userId,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.column('company_id').doUpdateSet({
            response_target_minutes: input.responseTargetMinutes,
            updated_by: access.userId,
            updated_at: now,
          }),
        )
        .returning(['response_target_minutes', 'updated_at'])
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        action: AuditActions.inboxTargetSet,
        actorUserId: access.userId,
        targetType: 'company',
        targetId: company.id,
        companyId: company.id,
        details: { previousMinutes: previous, minutes: input.responseTargetMinutes },
      });
      return {
        companyId: company.id,
        responseTargetMinutes: row.response_target_minutes,
        updatedAt: row.updated_at.toISOString(),
      };
    });
  }
}

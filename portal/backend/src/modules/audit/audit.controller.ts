import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { scopesWith, type Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { AuditService } from '../../platform/audit/audit.service';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { TenantDb } from '../../platform/tenancy/tenant-db';

const NIL = '00000000-0000-0000-0000-000000000000';
const Query_ = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().max(100).optional(),
  companyId: z.uuid().optional(),
});

/** Read access to the audit trail. Writing is only ever done by the platform through AuditService. */
@Controller('audit')
export class AuditController {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('audit.read')
  async list(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(Query_)) q: z.infer<typeof Query_>,
  ) {
    const scope = scopesWith(access, 'audit.read');
    return this.tenant.run(
      { userId: access.userId, groupIds: access.groupIds, companyIds: access.companyIds },
      async (trx) => {
        const groupCompanies = scope.groupIds.length
          ? (
              await trx
                .selectFrom('companies')
                .select('id')
                .where('group_id', 'in', scope.groupIds)
                .execute()
            ).map((c) => c.id)
          : [];
        const companyIds = [...new Set([...scope.companyIds, ...groupCompanies])];
        let query = trx
          .selectFrom('audit_events')
          .select([
            'id',
            'occurred_at',
            'actor_user_id',
            'action',
            'target_type',
            'target_id',
            'company_id',
            'correlation_id',
            'details',
          ])
          .where((eb) =>
            scope.groupIds.length
              ? eb.or([
                  eb('company_id', 'in', companyIds.length ? companyIds : [NIL]),
                  eb('company_id', 'is', null),
                ])
              : eb('company_id', 'in', companyIds.length ? companyIds : [NIL]),
          )
          .orderBy('id', 'desc')
          .limit(q.limit);
        if (q.action) query = query.where('action', '=', q.action);
        if (q.companyId) query = query.where('company_id', '=', q.companyId);
        return query.execute();
      },
    );
  }

  /** Walks the hash chain. Detects edited or removed rows; see docs/security/AUDIT.md for what that does and does not prove. */
  @Get('verify')
  @RequirePermission('audit.read')
  verify() {
    return this.audit.verifyChain();
  }
}

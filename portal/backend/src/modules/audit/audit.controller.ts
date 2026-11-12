import { Controller, Get, Header, Query } from '@nestjs/common';
import { z } from 'zod';
import { scopesWith, type Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import type { Transaction } from 'kysely';
import type { DB } from '../../platform/database/schema';
import { companyIdsWithPermission, NIL } from '../shared/tenant-scope';

const Filters = z.object({
  action: z.string().max(100).optional(),
  companyId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
  targetType: z.string().max(100).optional(),
  targetId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
const ListQuery = Filters.extend({ limit: z.coerce.number().int().min(1).max(200).default(50) });
const ExportQuery = Filters.extend({
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

const COLUMNS = [
  'id',
  'occurred_at',
  'actor_user_id',
  'action',
  'target_type',
  'target_id',
  'company_id',
  'correlation_id',
  'details',
] as const;

/** A spreadsheet treats a leading = + - @ as a formula: neutralise it, then quote the cell. */
const csvCell = (value: unknown): string => {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

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
    @Query(new ZodValidationPipe(ListQuery)) q: z.infer<typeof ListQuery>,
  ) {
    return this.tenant.run(
      { userId: access.userId, groupIds: access.groupIds, companyIds: access.companyIds },
      (trx) => this.search(trx, access, q, q.limit),
    );
  }

  /** CSV download of the same search (FR-07 "search and export"). The export itself is audited (proposal 9.1: "export logged"). */
  @Get('export')
  @RequirePermission('audit.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-export.csv"')
  async export(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(ExportQuery)) q: z.infer<typeof ExportQuery>,
  ): Promise<string> {
    return this.tenant.run(
      { userId: access.userId, groupIds: access.groupIds, companyIds: access.companyIds },
      async (trx) => {
        const rows = await this.search(trx, access, q, q.limit);
        const { limit: _limit, ...filters } = q;
        // Tie the event to a company when the export can only cover one, so a company-level auditor
        // can see their own exports; otherwise it is group-level (null), visible to group-level auditors.
        const scope = scopesWith(access, 'audit.read');
        const onlyCompany =
          !scope.groupIds.length && scope.companyIds.length === 1 ? scope.companyIds[0]! : null;
        await this.audit.record(trx, {
          action: AuditActions.auditExported,
          actorUserId: access.userId,
          targetType: 'audit_export',
          companyId: q.companyId ?? onlyCompany,
          details: { rows: rows.length, filters },
        });
        const header = COLUMNS.join(',');
        const lines = rows.map((r) =>
          COLUMNS.map((c) => csvCell(c === 'details' ? JSON.stringify(r[c]) : r[c])).join(','),
        );
        return [header, ...lines].join('\r\n') + '\r\n';
      },
    );
  }

  /** Walks the hash chain. Detects edited or removed rows; see docs/security/AUDIT.md for what that does and does not prove. */
  @Get('verify')
  @RequirePermission('audit.read')
  verify() {
    return this.audit.verifyChain();
  }

  private async search(
    trx: Transaction<DB>,
    access: Access,
    q: z.infer<typeof Filters>,
    limit: number,
  ) {
    const scope = scopesWith(access, 'audit.read');
    const companyIds = await companyIdsWithPermission(trx, access, 'audit.read');
    let query = trx
      .selectFrom('audit_events')
      .select(COLUMNS)
      .where((eb) =>
        scope.groupIds.length
          ? eb.or([
              eb('company_id', 'in', companyIds.length ? companyIds : [NIL]),
              eb('company_id', 'is', null),
            ])
          : eb('company_id', 'in', companyIds.length ? companyIds : [NIL]),
      )
      .orderBy('id', 'desc')
      .limit(limit);
    if (q.action) query = query.where('action', '=', q.action);
    if (q.companyId) query = query.where('company_id', '=', q.companyId);
    if (q.actorUserId) query = query.where('actor_user_id', '=', q.actorUserId);
    if (q.targetType) query = query.where('target_type', '=', q.targetType);
    if (q.targetId) query = query.where('target_id', '=', q.targetId);
    if (q.from) query = query.where('occurred_at', '>=', new Date(q.from));
    if (q.to) query = query.where('occurred_at', '<=', new Date(q.to));
    return query.execute();
  }
}

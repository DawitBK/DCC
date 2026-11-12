import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateIncidentRequest, IncidentDto, UpdateIncidentRequest } from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, scopesWith, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';

const NIL = '00000000-0000-0000-0000-000000000000';
const ctxOf = (a: Access) => ({ userId: a.userId, groupIds: a.groupIds, companyIds: a.companyIds });
const foreignKeyViolation = (e: unknown) => (e as { code?: string })?.code === '23503';

const INCIDENT_COLUMNS = [
  'id',
  'company_id',
  'social_account_id',
  'title',
  'description',
  'severity',
  'status',
  'opened_by',
  'opened_at',
  'resolved_at',
] as const;

/**
 * H-06, first cut (see docs/api/incidents.md): register, track and resolve an incident, optionally
 * tied to one social account. Follows the usual pattern: TenantDb.run, authz.can re-checked per
 * company, an audit event in the same transaction.
 */
@Injectable()
export class IncidentsService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(access: Access): Promise<IncidentDto[]> {
    const scope = scopesWith(access, 'incident.read');
    return this.tenant.run(ctxOf(access), async (trx) => {
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
      const rows = await trx
        .selectFrom('incidents')
        .select(INCIDENT_COLUMNS)
        .where('company_id', 'in', companyIds.length ? companyIds : [NIL])
        .orderBy('opened_at', 'desc')
        .execute();
      return rows.map(toDto);
    });
  }

  async get(access: Access, id: string): Promise<IncidentDto> {
    return this.tenant.run(ctxOf(access), async (trx) =>
      toDto(await this.loadIncident(trx, access, id, 'incident.read')),
    );
  }

  async create(access: Access, input: CreateIncidentRequest): Promise<IncidentDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const company = await trx
          .selectFrom('companies')
          .select(['id', 'group_id'])
          .where('id', '=', input.companyId)
          .executeTakeFirst();
        // RLS hides a company the caller cannot see; "not found" and "not yours" look identical.
        if (!company) throw new NotFoundException('Company not found.');
        if (!can(access, 'incident.manage', { groupId: company.group_id, companyId: company.id }))
          throw new ForbiddenException('You cannot manage incidents for this company.');

        const row = await trx
          .insertInto('incidents')
          .values({
            company_id: input.companyId,
            social_account_id: input.socialAccountId ?? null,
            title: input.title,
            description: input.description ?? null,
            severity: input.severity ?? undefined,
            opened_by: access.userId,
          })
          .returning(INCIDENT_COLUMNS)
          .executeTakeFirstOrThrow();

        await this.audit.record(trx, {
          action: AuditActions.incidentOpened,
          actorUserId: access.userId,
          targetType: 'incident',
          targetId: row.id,
          companyId: row.company_id,
          details: {
            title: row.title,
            severity: row.severity,
            socialAccountId: row.social_account_id,
          },
        });

        await this.notifications.notifyHolders(trx, {
          companyId: row.company_id,
          groupId: company.group_id,
          permission: 'incident.read',
          eventType: 'incident.opened',
          targetType: 'incident',
          targetId: row.id,
          summary: `An incident was opened: ${row.title}.`,
          excludeUserId: access.userId,
        });

        return toDto(row);
      });
    } catch (error) {
      if (foreignKeyViolation(error))
        throw new BadRequestException('The social account does not exist.');
      throw error;
    }
  }

  async update(access: Access, id: string, input: UpdateIncidentRequest): Promise<IncidentDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const incident = await this.loadIncident(trx, access, id, 'incident.manage');
      const resolving = input.status === 'resolved' || input.status === 'closed';

      const row = await trx
        .updateTable('incidents')
        .set({
          title: input.title ?? undefined,
          description: input.description ?? undefined,
          severity: input.severity ?? undefined,
          status: input.status ?? undefined,
          resolved_at: resolving ? new Date() : input.status ? null : undefined,
        })
        .where('id', '=', id)
        .returning(INCIDENT_COLUMNS)
        .executeTakeFirstOrThrow();

      await this.audit.record(trx, {
        action: AuditActions.incidentUpdated,
        actorUserId: access.userId,
        targetType: 'incident',
        targetId: id,
        companyId: incident.company_id,
        details: { from: incident.status, to: row.status },
      });
      return toDto(row);
    });
  }

  /** Loads the incident under the walls (RLS), 404s if hidden, then re-checks `permission` for its company. */
  private async loadIncident(
    trx: Parameters<Parameters<TenantDb['run']>[1]>[0],
    access: Access,
    id: string,
    permission: 'incident.read' | 'incident.manage',
  ) {
    const incident = await trx
      .selectFrom('incidents')
      .select(INCIDENT_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!incident) throw new NotFoundException('Incident not found.');
    const company = await trx
      .selectFrom('companies')
      .select('group_id')
      .where('id', '=', incident.company_id)
      .executeTakeFirstOrThrow();
    if (!can(access, permission, { groupId: company.group_id, companyId: incident.company_id }))
      throw new ForbiddenException('You cannot act on this incident.');
    return incident;
  }
}

const toDto = (r: {
  id: string;
  company_id: string;
  social_account_id: string | null;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  opened_by: string;
  opened_at: Date;
  resolved_at: Date | null;
}): IncidentDto => ({
  id: r.id,
  companyId: r.company_id,
  socialAccountId: r.social_account_id,
  title: r.title,
  description: r.description,
  severity: r.severity as IncidentDto['severity'],
  status: r.status as IncidentDto['status'],
  openedBy: r.opened_by,
  openedAt: r.opened_at.toISOString(),
  resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
});

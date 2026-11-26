import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  isSevereIncident,
  type CreateIncidentRequest,
  type IncidentDto,
  type IncidentSeverity,
  type IncidentWithReviewDto,
  type UpdateIncidentRequest,
} from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { IncidentDetailService } from './incident-detail.service';
import { IncidentReviewService, type ReviewStatus } from './incident-review.service';
import { NotificationsService } from '../notifications/notifications.service';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';

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
  'category_id',
  'review_required',
  'first_resolved_at',
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
    private readonly detail: IncidentDetailService,
    private readonly reviews: IncidentReviewService,
  ) {}

  async list(access: Access): Promise<IncidentWithReviewDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'incident.read');
      const rows = await trx
        .selectFrom('incidents')
        .select(INCIDENT_COLUMNS)
        .where('company_id', 'in', companyIds.length ? companyIds : [NIL])
        .orderBy('opened_at', 'desc')
        .execute();
      const extra = await this.detail.detailFor(trx, rows);
      const review = await this.reviews.statusFor(trx, rows);
      return rows.map((r) => toDto(r, extra, review.get(r.id)!));
    });
  }

  async get(access: Access, id: string): Promise<IncidentWithReviewDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const incident = await this.loadIncident(trx, access, id, 'incident.read');
      return this.present(trx, incident);
    });
  }

  async create(access: Access, input: CreateIncidentRequest): Promise<IncidentWithReviewDto> {
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

        if (input.categoryId)
          await this.detail.assertUsableCategory(trx, input.categoryId, company);
        const row = await trx
          .insertInto('incidents')
          .values({
            company_id: input.companyId,
            social_account_id: input.socialAccountId ?? null,
            title: input.title,
            description: input.description ?? null,
            severity: input.severity ?? undefined,
            category_id: input.categoryId ?? null,
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
            categoryId: row.category_id,
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

        return this.present(trx, row);
      });
    } catch (error) {
      if (foreignKeyViolation(error))
        throw new BadRequestException('The social account does not exist.');
      throw error;
    }
  }

  async update(
    access: Access,
    id: string,
    input: UpdateIncidentRequest,
  ): Promise<IncidentWithReviewDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const incident = await this.loadIncident(trx, access, id, 'incident.manage');
      const resolving = input.status === 'resolved' || input.status === 'closed';
      const closing = input.status === 'closed' && incident.status !== 'closed';
      let reviewId: string | null = null;
      if (closing) {
        // D2-23: a SEV1 or SEV2 incident (now, or at any time before) cannot be closed without its review.
        const severity = (input.severity ?? incident.severity) as IncidentSeverity;
        if (incident.review_required || isSevereIncident(severity)) {
          const review = await trx
            .selectFrom('incident_reviews')
            .select('id')
            .where('incident_id', '=', id)
            .executeTakeFirst();
          if (!review)
            throw new ConflictException(
              'A SEV1 or SEV2 incident cannot be closed until its post-incident review is recorded. ' +
                'Missing: the review (cause, impact, response, corrective actions, preventive measures, who took part and when it was held).',
            );
          reviewId = review.id;
        }
      }
      // Only a category that is being CHANGED must be usable now: an archived one stays on old incidents.
      if (input.categoryId && input.categoryId !== incident.category_id) {
        const company = await trx
          .selectFrom('companies')
          .select(['id', 'group_id'])
          .where('id', '=', incident.company_id)
          .executeTakeFirstOrThrow();
        await this.detail.assertUsableCategory(trx, input.categoryId, company);
      }

      const row = await trx
        .updateTable('incidents')
        .set({
          title: input.title ?? undefined,
          description: input.description ?? undefined,
          severity: input.severity ?? undefined,
          status: input.status ?? undefined,
          category_id: input.categoryId === undefined ? undefined : input.categoryId,
          // Resolved, then closed: the time it was resolved stays (it started the review clock).
          resolved_at: resolving
            ? (incident.resolved_at ?? new Date())
            : input.status
              ? null
              : undefined,
          // The first time ever; reopening never clears it and re-resolving never restarts the review clock.
          first_resolved_at: resolving && !incident.first_resolved_at ? new Date() : undefined,
        })
        .where('id', '=', id)
        .returning(INCIDENT_COLUMNS)
        .executeTakeFirstOrThrow();

      await this.audit.record(trx, {
        action: closing ? AuditActions.incidentClosed : AuditActions.incidentUpdated,
        actorUserId: access.userId,
        targetType: 'incident',
        targetId: id,
        companyId: incident.company_id,
        details: {
          from: incident.status,
          to: row.status,
          ...(closing && { severity: row.severity, reviewId }),
          ...(input.categoryId !== undefined && {
            categoryFrom: incident.category_id,
            categoryTo: row.category_id,
          }),
        },
      });
      if (closing) {
        const company = await trx
          .selectFrom('companies')
          .select('group_id')
          .where('id', '=', incident.company_id)
          .executeTakeFirstOrThrow();
        await this.notifications.notifyHolders(trx, {
          companyId: row.company_id,
          groupId: company.group_id,
          permission: 'incident.read',
          eventType: 'incident.closed',
          targetType: 'incident',
          targetId: row.id,
          summary: `An incident was closed: ${row.title}.`,
          excludeUserId: access.userId,
        });
      }
      return this.present(trx, row);
    });
  }

  private async present(
    trx: Parameters<Parameters<TenantDb['run']>[1]>[0],
    row: Parameters<typeof toDto>[0],
  ): Promise<IncidentWithReviewDto> {
    const [extra, review] = await Promise.all([
      this.detail.detailFor(trx, [row]),
      this.reviews.statusFor(trx, [row]),
    ]);
    return toDto(row, extra, review.get(row.id)!);
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

const toDto = (
  r: {
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
    category_id: string | null;
    review_required: boolean;
    first_resolved_at: Date | null;
  },
  extra: Awaited<ReturnType<IncidentDetailService['detailFor']>>,
  review: ReviewStatus,
): IncidentWithReviewDto => ({
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
  categoryId: r.category_id,
  category: extra.category(r.category_id),
  recoveryContacts: extra.contacts(r.company_id),
  reviewRequired: review.reviewRequired,
  reviewDueAt: review.reviewDueAt ? review.reviewDueAt.toISOString() : null,
  reviewOverdue: review.reviewOverdue,
  review: review.review,
});

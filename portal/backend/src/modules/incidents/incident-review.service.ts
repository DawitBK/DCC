import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  REVIEW_BUSINESS_DAYS,
  ROLES,
  ROLE_PERMISSIONS,
  isSevereIncident,
  type IncidentReviewDto,
  type IncidentSeverity,
  type Permission,
  type RecordIncidentReviewRequest,
  type Role,
} from '@dcc/contracts';
import type { Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';
import { SweepService } from '../working-hours/sweep.service';
import { WorkingHoursService } from '../working-hours/working-hours.service';
import { ctxOf, systemCheckContext } from '../shared/tenant-scope';
import { endOfBusinessDays, type WorkingCalendar } from '../shared/working-time';

type Trx = Transaction<DB>;

/** Who an overdue review is escalated to besides the incident managers (the Marketing & Communications Manager and senior management). */
export const ESCALATION_ROLES: readonly Role[] = ['company_executive', 'group_marketing'];

export const rolesHolding = (permission: Permission): Role[] =>
  ROLES.filter((r) => ROLE_PERMISSIONS[r].includes(permission));

interface ReviewRow {
  id: string;
  incident_id: string;
  cause: string;
  impact: string;
  response: string;
  corrective_actions: string;
  preventive_measures: string;
  participants: string[];
  held_at: Date;
  recorded_by: string;
  recorded_at: Date;
  updated_at: Date;
}

const REVIEW_COLUMNS = [
  'id',
  'incident_id',
  'cause',
  'impact',
  'response',
  'corrective_actions',
  'preventive_measures',
  'participants',
  'held_at',
  'recorded_by',
  'recorded_at',
  'updated_at',
] as const;

/** What the incident DTO needs about the review of each incident. */
export interface ReviewStatus {
  review: IncidentReviewDto | null;
  reviewRequired: boolean;
  reviewDueAt: Date | null;
  reviewOverdue: boolean;
}

/** The moment the review is due: 5 business days after the incident was first marked resolved. */
export const reviewDueAt = (firstResolvedAt: Date, cal: WorkingCalendar): Date =>
  endOfBusinessDays(firstResolvedAt, REVIEW_BUSINESS_DAYS, cal);

/** The reminder moment: the end of the business day before the due day (one business day of notice). */
export const reviewReminderAt = (firstResolvedAt: Date, cal: WorkingCalendar): Date =>
  endOfBusinessDays(firstResolvedAt, REVIEW_BUSINESS_DAYS - 1, cal);

/**
 * D2-23: the post-incident review. Every SEV1 and SEV2 incident (critical and high) needs a recorded review before
 * it can be closed (the check lives in IncidentsService.update, using hasReview here). The review is due within 5
 * business days of the first time the incident was marked resolved; the sweep reminds one business day before
 * and again when it is overdue, once each (escalation_events, kind `incident_review`). Nothing here ever closes
 * an incident by itself.
 */
@Injectable()
export class IncidentReviewService implements OnModuleInit {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly workingHours: WorkingHoursService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register('incident_review', (companyId, now) => this.sweepCompany(companyId, now));
  }

  async hasReview(trx: Trx, incidentId: string): Promise<boolean> {
    const row = await trx
      .selectFrom('incident_reviews')
      .select('id')
      .where('incident_id', '=', incidentId)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** Review fields for a set of incidents (one query for the reviews, one per company for the calendar). */
  async statusFor(
    trx: Trx,
    incidents: {
      id: string;
      company_id: string;
      severity: string;
      review_required: boolean;
      first_resolved_at: Date | null;
    }[],
    now: Date = new Date(),
  ): Promise<Map<string, ReviewStatus>> {
    const result = new Map<string, ReviewStatus>();
    if (incidents.length === 0) return result;
    const rows = await trx
      .selectFrom('incident_reviews')
      .select(REVIEW_COLUMNS)
      .where(
        'incident_id',
        'in',
        incidents.map((i) => i.id),
      )
      .execute();
    const userIds = [...new Set(rows.map((r) => r.recorded_by))];
    const names = userIds.length
      ? await trx
          .selectFrom('users')
          .select(['id', 'display_name'])
          .where('id', 'in', userIds)
          .execute()
      : [];
    const nameOf = new Map(names.map((n) => [n.id, n.display_name]));
    const reviews = new Map(
      rows.map((r) => [r.incident_id, toReviewDto(r, nameOf.get(r.recorded_by) ?? null)]),
    );
    const calendars = new Map<string, WorkingCalendar>();
    for (const i of incidents) {
      const review = reviews.get(i.id) ?? null;
      const required = i.review_required || isSevereIncident(i.severity as IncidentSeverity);
      let due: Date | null = null;
      if (required && i.first_resolved_at) {
        let cal = calendars.get(i.company_id);
        if (!cal) {
          cal = await this.workingHours.calendarOf(trx, i.company_id);
          calendars.set(i.company_id, cal);
        }
        due = reviewDueAt(i.first_resolved_at, cal);
      }
      result.set(i.id, {
        review,
        reviewRequired: required,
        reviewDueAt: due,
        reviewOverdue: required && review === null && due !== null && now > due,
      });
    }
    return result;
  }

  async record(
    access: Access,
    incidentId: string,
    input: RecordIncidentReviewRequest,
  ): Promise<IncidentReviewDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const incident = await trx
        .selectFrom('incidents')
        .select(['id', 'company_id', 'status', 'opened_at'])
        .where('id', '=', incidentId)
        .executeTakeFirst();
      if (!incident) throw new NotFoundException('Incident not found.');
      const company = await trx
        .selectFrom('companies')
        .select('group_id')
        .where('id', '=', incident.company_id)
        .executeTakeFirstOrThrow();
      if (
        !can(access, 'incident.manage', {
          groupId: company.group_id,
          companyId: incident.company_id,
        })
      )
        throw new ForbiddenException('You cannot record a review for this incident.');
      if (incident.status === 'closed')
        throw new ConflictException(
          'This incident is closed, so its review can no longer be changed. Reopen the incident first.',
        );

      const heldAt = new Date(input.heldAt);
      if (heldAt.getTime() > Date.now() + 60_000)
        throw new ConflictException('The review cannot have been held in the future.');
      if (heldAt < incident.opened_at)
        throw new ConflictException(
          'The review cannot have been held before the incident was opened.',
        );

      const values = {
        cause: input.cause,
        impact: input.impact,
        response: input.response,
        corrective_actions: input.correctiveActions,
        preventive_measures: input.preventiveMeasures,
        participants: input.participants,
        held_at: heldAt,
        updated_by: access.userId,
        updated_at: new Date(),
      };
      const existing = await trx
        .selectFrom('incident_reviews')
        .select('id')
        .where('incident_id', '=', incidentId)
        .executeTakeFirst();
      const row = existing
        ? await trx
            .updateTable('incident_reviews')
            .set(values)
            .where('id', '=', existing.id)
            .returning(REVIEW_COLUMNS)
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto('incident_reviews')
            .values({
              ...values,
              company_id: incident.company_id,
              incident_id: incidentId,
              recorded_by: access.userId,
            })
            .returning(REVIEW_COLUMNS)
            .executeTakeFirstOrThrow();
      const names = await trx
        .selectFrom('users')
        .select('display_name')
        .where('id', '=', row.recorded_by)
        .executeTakeFirst();

      await this.audit.record(trx, {
        action: AuditActions.incidentReviewRecorded,
        actorUserId: access.userId,
        targetType: 'incident',
        targetId: incidentId,
        companyId: incident.company_id,
        details: {
          reviewId: row.id,
          corrected: existing !== undefined,
          heldAt: heldAt.toISOString(),
          participants: input.participants.length,
        },
      });
      return toReviewDto(row, names?.display_name ?? null);
    });
  }

  /**
   * The sweep job for one company. Level 1: one business day before the due time, to the incident managers.
   * Level 2: overdue, to them and the escalation roles. Each level notifies once (escalation_events). If the
   * sweep only wakes up after the due time, level 1 is recorded without a message (a "due soon" note on an
   * overdue review would only confuse) and level 2 goes out.
   */
  async sweepCompany(companyId: string, now: Date): Promise<void> {
    await this.tenant.run(systemCheckContext(companyId), async (trx) => {
      const pending = await trx
        .selectFrom('incidents')
        .select(['id', 'title', 'first_resolved_at'])
        .where('company_id', '=', companyId)
        .where('review_required', '=', true)
        .where('status', '!=', 'closed')
        .where('first_resolved_at', 'is not', null)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('incident_reviews')
                .select('incident_reviews.id')
                .whereRef('incident_reviews.incident_id', '=', 'incidents.id'),
            ),
          ),
        )
        .execute();
      if (pending.length === 0) return;
      const cal = await this.workingHours.calendarOf(trx, companyId);
      for (const incident of pending) {
        const first = incident.first_resolved_at!;
        const overdue = now > reviewDueAt(first, cal);
        const reminder = now >= reviewReminderAt(first, cal);
        if (!reminder && !overdue) continue;
        const firstLevelNew = await this.recordLevel(trx, companyId, incident.id, 1);
        if (firstLevelNew && !overdue)
          await this.notifications.notifyRoles(trx, {
            companyId,
            roles: rolesHolding('incident.manage'),
            eventType: 'incident.review_due',
            targetType: 'incident',
            targetId: incident.id,
            summary: `The post-incident review of "${incident.title}" is due within one business day.`,
          });
        if (overdue && (await this.recordLevel(trx, companyId, incident.id, 2)))
          await this.notifications.notifyRoles(trx, {
            companyId,
            roles: [...new Set([...rolesHolding('incident.manage'), ...ESCALATION_ROLES])],
            eventType: 'incident.review_overdue',
            targetType: 'incident',
            targetId: incident.id,
            summary: `The post-incident review of "${incident.title}" is overdue. The incident cannot be closed until it is recorded.`,
          });
      }
    });
  }

  /** true when this level was recorded now (and so should notify), false when it had been recorded before. */
  private async recordLevel(
    trx: Trx,
    companyId: string,
    incidentId: string,
    level: number,
  ): Promise<boolean> {
    const inserted = await trx
      .insertInto('escalation_events')
      .values({ company_id: companyId, kind: 'incident_review', target_id: incidentId, level })
      .onConflict((oc) => oc.columns(['kind', 'target_id', 'level']).doNothing())
      .returning('id')
      .executeTakeFirst();
    return inserted !== undefined;
  }
}

const toReviewDto = (r: ReviewRow, recordedByName: string | null): IncidentReviewDto => ({
  id: r.id,
  incidentId: r.incident_id,
  cause: r.cause,
  impact: r.impact,
  response: r.response,
  correctiveActions: r.corrective_actions,
  preventiveMeasures: r.preventive_measures,
  participants: r.participants,
  heldAt: r.held_at.toISOString(),
  recordedBy: r.recorded_by,
  recordedByName,
  recordedAt: r.recorded_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

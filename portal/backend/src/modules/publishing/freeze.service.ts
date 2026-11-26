import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FreezeCheck } from '@dcc/engine-client';
import {
  FREEZE_LIFT_SIDES,
  isSevereIncident,
  type ConfirmFreezeLiftRequest,
  type CreateFreezeWithIncidentRequest,
  type FreezeLiftConfirmationDto,
  type FreezeLiftResultDto,
  type FreezeLiftSide,
  type FreezeWithLiftDto,
  type IncidentSeverity,
  type Permission,
} from '@dcc/contracts';
import { sql, type Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { rolesHolding } from '../incidents/incident-review.service';
import { NotificationsService } from '../notifications/notifications.service';
import { companyIdsWithPermission, ctxOf, NIL, systemCheckContext } from '../shared/tenant-scope';

const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

const FREEZE_COLUMNS = [
  'id',
  'company_id',
  'social_account_id',
  'frozen_by',
  'reason',
  'frozen_at',
  'incident_id',
  'two_person',
] as const;

type Trx = Transaction<DB>;
type FreezeRow = {
  id: string;
  company_id: string;
  social_account_id: string | null;
  frozen_by: string;
  reason: string | null;
  frozen_at: Date;
  incident_id: string | null;
  two_person: boolean;
};

const SIDE_PERMISSION: Record<FreezeLiftSide, Permission> = {
  security: 'security.manage',
  communications: 'publishing.lift_comms',
};
const SIDE_LABEL: Record<FreezeLiftSide, string> = {
  security: 'the security side (Group CTO or Security Administrator)',
  communications:
    'the communications side (Marketing & Communications Manager or senior management)',
};
const otherSide = (side: FreezeLiftSide): FreezeLiftSide =>
  side === 'security' ? 'communications' : 'security';

/**
 * H-05 (FR-15): the emergency freeze switch, per company or per account. isFrozen() is the
 * FreezeCheck interface GovernedEngine calls before it will ever publish anything - it runs as a
 * company-scoped system check (same reasoning as ContentApprovalVerifier: no policy it touches
 * reads app.user_id). freeze/unfreeze/list are the HTTP-facing side, run with the real caller's
 * access. Honest framing (per the onboarding task): this stops publishing THROUGH DCC, not people
 * posting directly on the network.
 *
 * Round 2 (D2-17, D2-18): a freeze may be tied to an incident of the same company. When that incident is
 * SEV1 or SEV2 (critical or high, now or at any earlier time) the freeze is lifted only by two confirmations
 * from two different people, one holding `security.manage` and one holding `publishing.lift_comms`; one person
 * can never give both. Any other freeze keeps the one-person unfreeze.
 */
@Injectable()
export class FreezeService implements FreezeCheck {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async isFrozen(scope: { companyId: string; channelId: string }): Promise<boolean> {
    return this.tenant.run(systemCheckContext(scope.companyId), async (trx) => {
      const row = await trx
        .selectFrom('publishing_freezes')
        .select('id')
        .where('company_id', '=', scope.companyId)
        .where((eb) =>
          eb.or([
            eb('social_account_id', 'is', null),
            eb.exists(
              eb
                .selectFrom('social_accounts')
                .select('social_accounts.id')
                .whereRef('social_accounts.id', '=', 'publishing_freezes.social_account_id')
                .where('social_accounts.engine_channel_id', '=', scope.channelId),
            ),
          ]),
        )
        .executeTakeFirst();
      return row !== undefined;
    });
  }

  async freeze(access: Access, input: CreateFreezeWithIncidentRequest): Promise<FreezeWithLiftDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const company = await trx
          .selectFrom('companies')
          .select(['id', 'group_id'])
          .where('id', '=', input.companyId)
          .executeTakeFirst();
        if (!company) throw new NotFoundException('Company not found.');
        if (!can(access, 'publishing.freeze', { groupId: company.group_id, companyId: company.id }))
          throw new ForbiddenException('You cannot freeze publishing for this company.');

        if (input.socialAccountId) {
          const account = await trx
            .selectFrom('social_accounts')
            .select('id')
            .where('id', '=', input.socialAccountId)
            .where('company_id', '=', input.companyId)
            .executeTakeFirst();
          if (!account) throw new NotFoundException('Social account not found.');
        }

        // Optional link to an incident of THIS company. A SEV1 or SEV2 incident (now, or at any earlier time)
        // makes the freeze a two-person one: it can then only be lifted by two confirmations.
        let twoPerson = false;
        if (input.incidentId) {
          const incident = await trx
            .selectFrom('incidents')
            .select(['id', 'status', 'severity', 'review_required'])
            .where('id', '=', input.incidentId)
            .where('company_id', '=', input.companyId)
            .executeTakeFirst();
          if (!incident) throw new NotFoundException('Incident not found.');
          if (!can(access, 'incident.read', { groupId: company.group_id, companyId: company.id }))
            throw new ForbiddenException(
              'You cannot link a freeze to an incident you are not allowed to read.',
            );
          if (incident.status === 'closed')
            throw new ConflictException(
              'This incident is closed, so a freeze cannot be tied to it.',
            );
          twoPerson = incident.review_required || isSevereIncident(incident.severity);
        }

        const row = await trx
          .insertInto('publishing_freezes')
          .values({
            company_id: input.companyId,
            social_account_id: input.socialAccountId ?? null,
            frozen_by: access.userId,
            reason: input.reason ?? null,
            incident_id: input.incidentId ?? null,
            two_person: twoPerson,
          })
          .returning(FREEZE_COLUMNS)
          .executeTakeFirstOrThrow();

        const dto = (await this.present(trx, [row]))[0]!;

        await this.notifications.notifyHolders(trx, {
          companyId: input.companyId,
          groupId: company.group_id,
          permission: 'content.publish',
          eventType: 'publishing.frozen',
          targetType: 'publishing_freeze',
          targetId: row.id,
          summary: input.socialAccountId
            ? 'Publishing was frozen for one account.'
            : 'Publishing was frozen for the whole company.',
          excludeUserId: access.userId,
        });

        await this.audit.record(trx, {
          action: AuditActions.publishingFrozen,
          actorUserId: access.userId,
          targetType: 'publishing_freeze',
          targetId: row.id,
          companyId: input.companyId,
          details: {
            socialAccountId: input.socialAccountId ?? null,
            reason: input.reason ?? null,
            incidentId: input.incidentId ?? null,
            twoPersonLift: twoPerson,
          },
        });
        return dto;
      });
    } catch (error) {
      if (uniqueViolation(error)) throw new ConflictException('This scope is already frozen.');
      throw error;
    }
  }

  async unfreeze(access: Access, freezeId: string): Promise<void> {
    await this.tenant.run(ctxOf(access), async (trx) => {
      const { freeze, group_id } = await this.loadFreeze(trx, freezeId);
      if (
        !can(access, 'publishing.freeze', {
          groupId: group_id,
          companyId: freeze.company_id,
        })
      )
        throw new ForbiddenException('You cannot unfreeze publishing for this company.');

      // D2-17: a freeze tied to a SEV1 or SEV2 incident is lifted by two confirmations, never by this route.
      if (await this.needsTwoPersons(trx, freeze)) {
        const missing = await this.missingSides(trx, freezeId);
        throw new ConflictException(
          'This freeze is tied to a SEV1 or SEV2 incident, so it can only be lifted by two confirmations from two different people. ' +
            (missing.length
              ? `Still missing: ${missing.map((m) => SIDE_LABEL[m]).join(' and ')}.`
              : 'Both confirmations are already in place.'),
        );
      }

      await trx.deleteFrom('publishing_freezes').where('id', '=', freezeId).execute();

      await this.audit.record(trx, {
        action: AuditActions.publishingUnfrozen,
        actorUserId: access.userId,
        targetType: 'publishing_freeze',
        targetId: freezeId,
        companyId: freeze.company_id,
        details: { socialAccountId: freeze.social_account_id },
      });
    });
  }

  /**
   * The freezes the caller may see. `permission` is the one the route asked for: `publishing.freeze` (the
   * normal list) or `publishing.lift_comms` (the communications side holds no freeze permission of its own,
   * yet must see the freezes it is asked to lift).
   */
  async list(
    access: Access,
    permission: 'publishing.freeze' | 'publishing.lift_comms' = 'publishing.freeze',
  ): Promise<FreezeWithLiftDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, permission);
      const rows = await trx
        .selectFrom('publishing_freezes')
        .select(FREEZE_COLUMNS)
        .where('company_id', 'in', companyIds.length ? companyIds : [NIL])
        .orderBy('frozen_at', 'desc')
        .execute();
      return this.present(trx, rows);
    });
  }

  /** One of the two confirmations (D2-18). The second one, from a different person on the other side, lifts the freeze. */
  async confirmLift(
    access: Access,
    freezeId: string,
    side: FreezeLiftSide,
    input: ConfirmFreezeLiftRequest,
  ): Promise<FreezeLiftResultDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        await this.lockLift(trx, freezeId);
        const { freeze, group_id } = await this.loadFreeze(trx, freezeId);
        if (
          !can(access, SIDE_PERMISSION[side], { groupId: group_id, companyId: freeze.company_id })
        )
          throw new ForbiddenException(
            `You cannot give the ${side} confirmation for this company.`,
          );
        if (!(await this.needsTwoPersons(trx, freeze)))
          throw new ConflictException(
            'This freeze is not tied to a SEV1 or SEV2 incident. Lift it with the normal unfreeze.',
          );

        const live = await this.liveConfirmations(trx, freezeId);
        if (live.some((c) => c.confirmed_by === access.userId))
          throw new ConflictException(
            'You have already given a confirmation for this freeze. The other one must come from a different person.',
          );
        if (live.some((c) => c.side === side))
          throw new ConflictException(`The ${side} side has already confirmed.`);

        await trx
          .insertInto('freeze_lift_confirmations')
          .values({
            company_id: freeze.company_id,
            freeze_id: freezeId,
            side,
            confirmed_by: access.userId,
            note: input.note ?? null,
          })
          .execute();

        const incident = freeze.incident_id
          ? await trx
              .selectFrom('incidents')
              .select(['title'])
              .where('id', '=', freeze.incident_id)
              .executeTakeFirst()
          : undefined;
        const what = incident ? `the incident "${incident.title}"` : 'an incident';
        const lifted = live.length + 1 >= FREEZE_LIFT_SIDES.length;

        if (!lifted) {
          const other = otherSide(side);
          await this.notifications.notifyRoles(trx, {
            companyId: freeze.company_id,
            roles: rolesHolding(SIDE_PERMISSION[other]),
            eventType: 'incident.freeze_lift_requested',
            targetType: 'publishing_freeze',
            targetId: freezeId,
            summary: `The ${side} side has asked to lift the publishing freeze tied to ${what}. ${capitalise(SIDE_LABEL[other])} must confirm too.`,
            excludeUserIds: [access.userId],
          });
        } else {
          await trx.deleteFrom('publishing_freezes').where('id', '=', freezeId).execute();
          const summary = `Publishing was unfrozen after both confirmations (${what}).`;
          const told = await this.notifications.notifyRoles(trx, {
            companyId: freeze.company_id,
            roles: [
              ...new Set(
                (
                  [
                    'publishing.freeze',
                    'security.manage',
                    'publishing.lift_comms',
                    'content.publish',
                  ] as const
                ).flatMap((p) => rolesHolding(p)),
              ),
            ],
            eventType: 'incident.freeze_lifted',
            targetType: 'publishing_freeze',
            targetId: freezeId,
            summary,
            excludeUserIds: [access.userId],
          });
          // The person who froze and the first confirmer are told even if their roles no longer cover it.
          for (const userId of new Set([freeze.frozen_by, ...live.map((c) => c.confirmed_by)]))
            if (userId !== access.userId && !told.includes(userId))
              await this.notifications.notifyUser(trx, {
                companyId: freeze.company_id,
                recipientUserId: userId,
                eventType: 'incident.freeze_lifted',
                targetType: 'publishing_freeze',
                targetId: freezeId,
                summary,
              });
        }

        const result: FreezeLiftResultDto = lifted
          ? { freezeId, lifted: true, freeze: null }
          : {
              freezeId,
              lifted: false,
              freeze: (await this.present(trx, [freeze]))[0]!,
            };

        await this.audit.record(trx, {
          action: AuditActions.freezeLiftConfirmed,
          actorUserId: access.userId,
          targetType: 'publishing_freeze',
          targetId: freezeId,
          companyId: freeze.company_id,
          details: {
            event: 'confirmed',
            side,
            note: input.note ?? null,
            incidentId: freeze.incident_id,
            lifted,
          },
        });
        if (lifted)
          await this.audit.record(trx, {
            action: AuditActions.publishingUnfrozen,
            actorUserId: access.userId,
            targetType: 'publishing_freeze',
            targetId: freezeId,
            companyId: freeze.company_id,
            details: {
              socialAccountId: freeze.social_account_id,
              twoPersonLift: true,
              confirmedBy: [...live.map((c) => c.confirmed_by), access.userId],
            },
          });
        return result;
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('That confirmation was already given. Reload and look again.');
      throw error;
    }
  }

  /** The giver takes a confirmation back, as long as the second one has not arrived (once it has, the freeze is gone). */
  async withdrawLift(
    access: Access,
    freezeId: string,
    side: FreezeLiftSide,
  ): Promise<FreezeWithLiftDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      await this.lockLift(trx, freezeId);
      const { freeze, group_id } = await this.loadFreeze(trx, freezeId);
      if (!can(access, SIDE_PERMISSION[side], { groupId: group_id, companyId: freeze.company_id }))
        throw new ForbiddenException(
          `You cannot withdraw the ${side} confirmation for this company.`,
        );
      const mine = (await this.liveConfirmations(trx, freezeId)).find((c) => c.side === side);
      if (!mine) throw new NotFoundException(`There is no ${side} confirmation to withdraw.`);
      if (mine.confirmed_by !== access.userId)
        throw new ForbiddenException('Only the person who gave a confirmation can withdraw it.');
      await trx
        .updateTable('freeze_lift_confirmations')
        .set({ withdrawn_at: new Date() })
        .where('id', '=', mine.id)
        .execute();
      const dto = (await this.present(trx, [freeze]))[0]!;
      await this.audit.record(trx, {
        action: AuditActions.freezeLiftConfirmed,
        actorUserId: access.userId,
        targetType: 'publishing_freeze',
        targetId: freezeId,
        companyId: freeze.company_id,
        details: { event: 'withdrawn', side, incidentId: freeze.incident_id },
      });
      return dto;
    });
  }

  /** One confirmation at a time per freeze, so two people confirming together cannot both see "one is missing". */
  private async lockLift(trx: Trx, freezeId: string): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtext(${'freeze-lift:' + freezeId}))`.execute(trx);
  }

  private async loadFreeze(
    trx: Trx,
    freezeId: string,
  ): Promise<{ freeze: FreezeRow; group_id: string }> {
    const freeze = await trx
      .selectFrom('publishing_freezes')
      .select(FREEZE_COLUMNS)
      .where('id', '=', freezeId)
      .executeTakeFirst();
    // Row-level security hides another company's freeze: "not found" and "not yours" look the same.
    if (!freeze) throw new NotFoundException('Freeze not found.');
    const company = await trx
      .selectFrom('companies')
      .select('group_id')
      .where('id', '=', freeze.company_id)
      .executeTakeFirstOrThrow();
    return { freeze, group_id: company.group_id };
  }

  /** Two persons are needed when the freeze was tied to a SEV1/SEV2 incident, or its incident has become one since. */
  private async needsTwoPersons(trx: Trx, freeze: FreezeRow): Promise<boolean> {
    if (freeze.two_person) return true;
    if (!freeze.incident_id) return false;
    const incident = await trx
      .selectFrom('incidents')
      .select(['severity', 'review_required'])
      .where('id', '=', freeze.incident_id)
      .executeTakeFirst();
    return (
      incident !== undefined && (incident.review_required || isSevereIncident(incident.severity))
    );
  }

  private async liveConfirmations(trx: Trx, freezeId: string) {
    return trx
      .selectFrom('freeze_lift_confirmations')
      .select(['id', 'side', 'confirmed_by', 'note', 'confirmed_at'])
      .where('freeze_id', '=', freezeId)
      .where('withdrawn_at', 'is', null)
      .orderBy('confirmed_at', 'asc')
      .execute();
  }

  private async missingSides(trx: Trx, freezeId: string): Promise<FreezeLiftSide[]> {
    const live = await this.liveConfirmations(trx, freezeId);
    return FREEZE_LIFT_SIDES.filter((side) => !live.some((c) => c.side === side));
  }

  /** The DTOs for a set of freezes: incident title and severity, live confirmations with names, and what is missing. */
  private async present(trx: Trx, rows: FreezeRow[]): Promise<FreezeWithLiftDto[]> {
    if (rows.length === 0) return [];
    const incidentIds = [...new Set(rows.flatMap((r) => (r.incident_id ? [r.incident_id] : [])))];
    const incidents = incidentIds.length
      ? await trx
          .selectFrom('incidents')
          .select(['id', 'title', 'severity', 'review_required'])
          .where('id', 'in', incidentIds)
          .execute()
      : [];
    const incidentOf = new Map(incidents.map((i) => [i.id, i]));
    const confirmations = await trx
      .selectFrom('freeze_lift_confirmations')
      .select(['id', 'freeze_id', 'side', 'confirmed_by', 'note', 'confirmed_at'])
      .where(
        'freeze_id',
        'in',
        rows.map((r) => r.id),
      )
      .where('withdrawn_at', 'is', null)
      .orderBy('confirmed_at', 'asc')
      .execute();
    const userIds = [...new Set(confirmations.map((c) => c.confirmed_by))];
    const names = userIds.length
      ? await trx
          .selectFrom('users')
          .select(['id', 'display_name'])
          .where('id', 'in', userIds)
          .execute()
      : [];
    const nameOf = new Map(names.map((n) => [n.id, n.display_name]));
    return rows.map((r) => {
      const incident = r.incident_id ? incidentOf.get(r.incident_id) : undefined;
      const twoPersonLift =
        r.two_person ||
        (incident !== undefined &&
          (incident.review_required || isSevereIncident(incident.severity)));
      const live: FreezeLiftConfirmationDto[] = confirmations
        .filter((c) => c.freeze_id === r.id)
        .map((c) => ({
          id: c.id,
          side: c.side,
          confirmedBy: c.confirmed_by,
          confirmedByName: nameOf.get(c.confirmed_by) ?? null,
          note: c.note,
          confirmedAt: c.confirmed_at.toISOString(),
        }));
      return {
        id: r.id,
        companyId: r.company_id,
        socialAccountId: r.social_account_id,
        frozenBy: r.frozen_by,
        reason: r.reason,
        frozenAt: r.frozen_at.toISOString(),
        incidentId: r.incident_id,
        incidentTitle: incident?.title ?? null,
        incidentSeverity: (incident?.severity as IncidentSeverity | undefined) ?? null,
        twoPersonLift,
        liftConfirmations: live,
        liftMissing: twoPersonLift
          ? FREEZE_LIFT_SIDES.filter((side) => !live.some((c) => c.side === side))
          : [],
      };
    });
  }
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

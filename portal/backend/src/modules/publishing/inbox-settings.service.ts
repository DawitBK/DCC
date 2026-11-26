import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_INBOX_TARGETS,
  type InboxClockSettingsDto,
  type SetInboxClockSettingsRequest,
} from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';

type Targets = Pick<
  InboxClockSettingsDto,
  'urgentTargetMinutes' | 'normalTargetMinutes' | 'lowTargetMinutes' | 'urgentRoundTheClock'
>;

const DEFAULTS: Targets = {
  urgentTargetMinutes: DEFAULT_INBOX_TARGETS.urgent,
  normalTargetMinutes: DEFAULT_INBOX_TARGETS.normal,
  lowTargetMinutes: DEFAULT_INBOX_TARGETS.low,
  urgentRoundTheClock: false,
};

/**
 * H-14 and Round 2 (sheet E-07): the per-company response targets of the inbox. Urgent 1 hour, normal 4 working
 * hours, low 24 hours are the defaults (owner-approved, stored per company once changed); the old single
 * `responseTargetMinutes` is the normal target. Managing them needs `inbox.manage` for the company, or
 * `approval_policy.manage` (the gate this had before Round 2: both stay allowed).
 */
@Injectable()
export class InboxSettingsService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
  ) {}

  /** One entry per company the caller may read the inbox of, with its own values or the defaults. */
  async list(access: Access): Promise<InboxClockSettingsDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'inbox.read');
      const rows = await trx
        .selectFrom('companies as c')
        .leftJoin('inbox_settings as s', 's.company_id', 'c.id')
        .select([
          'c.id as companyId',
          's.urgent_target_minutes',
          's.normal_target_minutes',
          's.low_target_minutes',
          's.urgent_round_the_clock',
          's.updated_at',
        ])
        .where('c.id', 'in', companyIds.length ? companyIds : [NIL])
        .orderBy('c.name')
        .execute();
      return rows.map((r) =>
        toDto(
          r.companyId,
          r.updated_at
            ? {
                urgentTargetMinutes: r.urgent_target_minutes!,
                normalTargetMinutes: r.normal_target_minutes!,
                lowTargetMinutes: r.low_target_minutes!,
                urgentRoundTheClock: r.urgent_round_the_clock!,
              }
            : DEFAULTS,
          r.updated_at ?? null,
        ),
      );
    });
  }

  async set(access: Access, input: SetInboxClockSettingsRequest): Promise<InboxClockSettingsDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await trx
        .selectFrom('companies')
        .select(['id', 'group_id'])
        .where('id', '=', input.companyId)
        .executeTakeFirst();
      if (!company) throw new NotFoundException('Company not found.');
      const scope = { groupId: company.group_id, companyId: company.id };
      if (!can(access, 'inbox.manage', scope) && !can(access, 'approval_policy.manage', scope))
        throw new ForbiddenException('You cannot change the inbox settings of this company.');
      const existing = await trx
        .selectFrom('inbox_settings')
        .select([
          'urgent_target_minutes',
          'normal_target_minutes',
          'low_target_minutes',
          'urgent_round_the_clock',
          'updated_at',
        ])
        .where('company_id', '=', company.id)
        .forUpdate()
        .executeTakeFirst();
      const previous: Targets = existing
        ? {
            urgentTargetMinutes: existing.urgent_target_minutes,
            normalTargetMinutes: existing.normal_target_minutes,
            lowTargetMinutes: existing.low_target_minutes,
            urgentRoundTheClock: existing.urgent_round_the_clock,
          }
        : DEFAULTS;
      // The old field is the normal target; null puts it back to its default.
      const normal =
        input.normalTargetMinutes ??
        (input.responseTargetMinutes === undefined
          ? undefined
          : (input.responseTargetMinutes ?? DEFAULTS.normalTargetMinutes));
      const next: Targets = {
        urgentTargetMinutes: input.urgentTargetMinutes ?? previous.urgentTargetMinutes,
        normalTargetMinutes: normal ?? previous.normalTargetMinutes,
        lowTargetMinutes: input.lowTargetMinutes ?? previous.lowTargetMinutes,
        urgentRoundTheClock: input.urgentRoundTheClock ?? previous.urgentRoundTheClock,
      };
      const changed = (Object.keys(next) as (keyof Targets)[]).some((k) => next[k] !== previous[k]);
      if (existing && !changed) return toDto(company.id, previous, existing.updated_at);
      const now = new Date();
      const values = {
        response_target_minutes: next.normalTargetMinutes,
        urgent_target_minutes: next.urgentTargetMinutes,
        normal_target_minutes: next.normalTargetMinutes,
        low_target_minutes: next.lowTargetMinutes,
        urgent_round_the_clock: next.urgentRoundTheClock,
        updated_by: access.userId,
        updated_at: now,
      };
      await trx
        .insertInto('inbox_settings')
        .values({ company_id: company.id, ...values })
        .onConflict((oc) => oc.column('company_id').doUpdateSet(values))
        .execute();
      await this.audit.record(trx, {
        action: AuditActions.inboxTargetSet,
        actorUserId: access.userId,
        targetType: 'company',
        targetId: company.id,
        companyId: company.id,
        details: { from: previous, to: next },
      });
      return toDto(company.id, next, now);
    });
  }
}

const toDto = (companyId: string, t: Targets, updatedAt: Date | null): InboxClockSettingsDto => ({
  companyId,
  responseTargetMinutes: t.normalTargetMinutes,
  ...t,
  updatedAt: updatedAt ? updatedAt.toISOString() : null,
});

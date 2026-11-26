import {
  APPROVAL_VALIDITY_DAYS,
  EMERGENCY_CONFIRM_HOURS,
  ROLES,
  ROLE_PERMISSIONS,
  type ApprovalClock,
  type ApprovalRulesFields,
  type ApprovalState,
  type Role,
} from '@dcc/contracts';
import { APPROVAL_LADDER, dueAt, type WorkingCalendar } from '../shared/working-time';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The roles whose holders may approve content (they hold `content.approve`). */
export const APPROVER_ROLE_LIST: readonly Role[] = ROLES.filter((r) =>
  ROLE_PERMISSIONS[r].includes('content.approve'),
);

/** Who an escalation goes to above the approvers: the Marketing & Communications Manager and senior management. */
export const ESCALATION_ROLES: readonly Role[] = ['company_executive', 'group_marketing'];

/** Crisis-sized limits (round the clock, an hour or less) escalate at 15, 30 and 45 minutes of the hour. */
export const CRISIS_LADDER = [0.25, 0.5, 0.75] as const;

/** The emergency confirmation is owed 24 hours after the emergency approval, then again at 48 hours (round the clock). */
export const EMERGENCY_LADDER = [1, 2] as const;

export const ladderFor = (clock: ApprovalClock, limitMinutes: number): readonly number[] =>
  clock === 'continuous' && limitMinutes <= 60 ? CRISIS_LADDER : APPROVAL_LADDER;

/** Is the last step of this ladder the one counted as a miss for the monthly report? Always: the last level. */
export const lastLevelOf = (clock: ApprovalClock, limitMinutes: number): number =>
  ladderFor(clock, limitMinutes).length;

/** The last moment an approval given at `approvedAt` can still be used. */
export const validUntilOf = (approvedAt: Date): Date =>
  new Date(approvedAt.getTime() + APPROVAL_VALIDITY_DAYS * DAY_MS);

/** An approval is valid up to and including `validUntil`; one millisecond later it has expired. */
export const approvalIsPast = (validUntil: Date | null, now: Date): boolean =>
  validUntil !== null && now.getTime() > validUntil.getTime();

export const emergencyConfirmDue = (emergencyAt: Date): Date =>
  new Date(emergencyAt.getTime() + EMERGENCY_CONFIRM_HOURS * HOUR_MS);

/** The columns of an approval request the rules read. */
export interface RuleRow {
  status: string;
  requested_at: Date;
  time_limit_hours: number | null;
  clock: ApprovalClock;
  escalation_level: number;
  approved_at: Date | null;
  valid_until: Date | null;
  emergency: boolean;
  emergency_by: string | null;
  emergency_reason: string | null;
  emergency_at: Date | null;
  emergency_confirmed_by: string | null;
  emergency_confirmed_at: Date | null;
}

/** The stored state, or `expired` when the approval has run out and the sweep has not recorded it yet. */
export const effectiveState = (
  row: Pick<RuleRow, 'status' | 'valid_until'>,
  now: Date,
): ApprovalState =>
  row.status === 'approved' && approvalIsPast(row.valid_until, now)
    ? 'expired'
    : (row.status as ApprovalState);

/** Validity, clock and emergency facts of one request, as the API shows them. */
export function ruleFields(row: RuleRow, cal: WorkingCalendar, now: Date): ApprovalRulesFields {
  const state = effectiveState(row, now);
  const due =
    state === 'pending' && row.time_limit_hours !== null
      ? dueAt(row.requested_at, row.time_limit_hours * 60, row.clock, cal)
      : null;
  return {
    timeLimitHours: row.time_limit_hours,
    clock: row.clock,
    dueAt: due ? due.toISOString() : null,
    escalationLevel: row.escalation_level,
    overdue: due !== null && now.getTime() > due.getTime(),
    approvedAt: row.approved_at ? row.approved_at.toISOString() : null,
    validUntil: row.valid_until ? row.valid_until.toISOString() : null,
    expired: state === 'expired',
    emergency: row.emergency,
    emergencyBy: row.emergency_by,
    emergencyReason: row.emergency_reason,
    emergencyAt: row.emergency_at ? row.emergency_at.toISOString() : null,
    emergencyConfirmedBy: row.emergency_confirmed_by,
    emergencyConfirmedAt: row.emergency_confirmed_at
      ? row.emergency_confirmed_at.toISOString()
      : null,
    emergencyConfirmDueAt:
      row.emergency && row.emergency_at && !row.emergency_confirmed_at
        ? emergencyConfirmDue(row.emergency_at).toISOString()
        : null,
  };
}

export interface VersionApprovalRow {
  id: string;
  status: string;
  valid_until: Date | null;
  requested_at: Date;
}

export type VersionApproval =
  { ok: true; request: VersionApprovalRow } | { ok: false; reason: string; expired: boolean };

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Which request, if any, lets this version be published at `now`: an approved request whose seven days have not run
 * out. Several requests may exist for one version (an expired one, then a new one), so the newest usable one wins.
 */
export function usableApproval(rows: readonly VersionApprovalRow[], now: Date): VersionApproval {
  const sorted = [...rows].sort((a, b) => b.requested_at.getTime() - a.requested_at.getTime());
  const usable = sorted.find((r) => r.status === 'approved' && !approvalIsPast(r.valid_until, now));
  if (usable) return { ok: true, request: usable };
  const lapsed = sorted.find((r) => effectiveState(r, now) === 'expired');
  if (lapsed)
    return {
      ok: false,
      expired: true,
      reason: `The approval of this version expired${
        lapsed.valid_until ? ` on ${day(lapsed.valid_until)}` : ''
      } (an approval lasts ${APPROVAL_VALIDITY_DAYS} days). Submit this version for approval again.`,
    };
  return { ok: false, expired: false, reason: 'This version is not approved.' };
}

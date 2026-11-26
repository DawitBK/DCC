// Round 2 (2026-11-26), approvals: seven-day validity, time limits and the escalation ladder, the emergency post and
// the category change. Types and schemas of this area live here, so parallel work never edits the same lines.
import { z } from 'zod';
import type {
  ApprovalPolicyDto,
  ApprovalQueueItemDto,
  ApprovalRequestDto,
  ContentItemDto,
} from './api';

/** An approval is valid for this many CALENDAR days from the moment the request is settled as approved (sheet C1-07). */
export const APPROVAL_VALIDITY_DAYS = 7;

/** How a time limit counts: office hours (Monday to Saturday 08:30 to 17:30, public holidays out) or round the clock (crisis). */
export const APPROVAL_CLOCKS = ['working', 'continuous'] as const;
export type ApprovalClock = (typeof APPROVAL_CLOCKS)[number];

/** The longest limit a policy may set, in hours (30 days). */
export const MAX_TIME_LIMIT_HOURS = 720;

/**
 * The states of an approval request. `expired` is new: the request was approved, nobody published it within
 * seven days, so the approval no longer counts. (`APPROVAL_REQUEST_STATUSES` in platforms.ts does not have it yet.)
 */
export const APPROVAL_STATES = ['pending', 'approved', 'rejected', 'expired'] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

/** A content item can now also be `expired` (its approval ran out). (`CONTENT_ITEM_STATUSES` does not have it yet.) */
export const CONTENT_ITEM_EXPIRED = 'expired' as const;

/** The time limit part of a policy, as the policy screen and the API carry it. */
export const TimeLimitFields = z.object({
  /** null = no time limit, so no clock and no reminders. */
  timeLimitHours: z.number().int().min(1).max(MAX_TIME_LIMIT_HOURS).nullable().optional(),
  clock: z.enum(APPROVAL_CLOCKS).optional(),
});

/** What the API sends for a policy: the old fields plus its time limit. */
export type ApprovalPolicyFullDto = ApprovalPolicyDto & {
  /** null = no time limit. */
  timeLimitHours: number | null;
  clock: ApprovalClock;
};

/** Validity, clock and emergency facts of a request, shared by the full DTO and the queue row. */
export interface ApprovalRulesFields {
  /** The limit copied from the policy when the request was submitted; null = no clock. */
  timeLimitHours: number | null;
  clock: ApprovalClock;
  /** When the limit runs out (counting working time or round the clock); null when there is no limit. */
  dueAt: string | null;
  /** How far the escalation ladder has gone (0 = not yet reminded). */
  escalationLevel: number;
  /** A pending request past its limit. */
  overdue: boolean;
  /** When the request was settled as approved. */
  approvedAt: string | null;
  /** The last moment the approval can be used (7 days after approval). */
  validUntil: string | null;
  /** True when the approval ran out (the stored state, or detected the moment it was read). */
  expired: boolean;
  /** Settled by one emergency approver alone; a second approval is owed. */
  emergency: boolean;
  emergencyBy: string | null;
  emergencyReason: string | null;
  emergencyAt: string | null;
  /** When someone else confirmed the emergency approval; null while the confirmation is still owed. */
  emergencyConfirmedBy: string | null;
  emergencyConfirmedAt: string | null;
  /** When the confirmation is due (24 hours after the emergency approval, round the clock). */
  emergencyConfirmDueAt: string | null;
}

export type ApprovalRequestFullDto = Omit<ApprovalRequestDto, 'status'> &
  ApprovalRulesFields & { status: ApprovalState };

export type ApprovalQueueRowDto = Omit<ApprovalQueueItemDto, 'status'> &
  ApprovalRulesFields & {
    status: ApprovalState;
    /** The content item's category, so the screen can show it. */
    categoryId: string | null;
  };

/** The item's status can be `expired` too. */
export type ContentItemStateDto = Omit<ContentItemDto, 'status'> & {
  status: ContentItemDto['status'] | typeof CONTENT_ITEM_EXPIRED;
};

/** Settle a pending request as approved ALONE, in an emergency (sheet C1-14). The reason is written down and audited. */
export const EMERGENCY_REASON_MIN = 20;
export const EmergencyApproveRequest = z.object({
  reason: z.string().trim().min(EMERGENCY_REASON_MIN).max(2_000),
});
export type EmergencyApproveRequest = z.infer<typeof EmergencyApproveRequest>;

/** Confirm an emergency approval as the second, different person. The comment is optional. */
export const ConfirmEmergencyRequest = z.object({
  comment: z.string().trim().min(1).max(2_000).optional(),
});
export type ConfirmEmergencyRequest = z.infer<typeof ConfirmEmergencyRequest>;

/** The confirmation of an emergency approval is due this many hours after it (round the clock). */
export const EMERGENCY_CONFIRM_HOURS = 24;

/** Change the category of an item that is in review. Only to a stricter one; the reason is required. */
export const CATEGORY_CHANGE_REASON_MIN = 10;
export const ChangeContentCategoryRequest = z.object({
  categoryId: z.uuid(),
  reason: z.string().trim().min(CATEGORY_CHANGE_REASON_MIN).max(2_000),
});
export type ChangeContentCategoryRequest = z.infer<typeof ChangeContentCategoryRequest>;

/** Escalations that were missed, per company and month, for the monthly executive report (sheet C1-11). */
export interface ApprovalMissesDto {
  companyId: string;
  /** `YYYY-MM`, in the company's own time. */
  month: string;
  /** Requests that reached the last step of the ladder (200% of the limit; the 45-minute step for a crisis). */
  approvalMisses: number;
  /** Emergency approvals still unconfirmed 48 hours after they were given. */
  emergencyFollowupMisses: number;
}

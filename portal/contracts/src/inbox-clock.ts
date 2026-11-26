// Round 2, inbox clock (2026-11-26): priority, working-hours response targets, escalation. Own file, so parallel work never edits the same lines.
import { z } from 'zod';
import type { InboxMessageDto, InboxSettingsDto } from './api';

export const INBOX_PRIORITIES = ['urgent', 'normal', 'low'] as const;
export type InboxPriority = (typeof INBOX_PRIORITIES)[number];

/** Sheet E-07: the targets a company starts with (minutes): urgent 1 hour, normal 4 working hours, low 24 hours. */
export const DEFAULT_INBOX_TARGETS: Readonly<Record<InboxPriority, number>> = {
  urgent: 60,
  normal: 240,
  low: 1440,
};

const targetMinutes = z.number().int().min(1).max(43_200);

/**
 * Sets a company's inbox clock. `responseTargetMinutes` is the old field, kept: it is the normal target
 * (`null` puts the normal target back to its default). At least one field besides `companyId` is required.
 */
export const SetInboxClockSettingsRequest = z
  .object({
    companyId: z.uuid(),
    responseTargetMinutes: targetMinutes.nullable().optional(),
    urgentTargetMinutes: targetMinutes.optional(),
    normalTargetMinutes: targetMinutes.optional(),
    lowTargetMinutes: targetMinutes.optional(),
    urgentRoundTheClock: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.responseTargetMinutes !== undefined ||
      v.urgentTargetMinutes !== undefined ||
      v.normalTargetMinutes !== undefined ||
      v.lowTargetMinutes !== undefined ||
      v.urgentRoundTheClock !== undefined,
    { message: 'Give at least one setting to change.' },
  )
  .refine(
    (v) =>
      v.responseTargetMinutes === undefined ||
      v.normalTargetMinutes === undefined ||
      v.responseTargetMinutes === v.normalTargetMinutes,
    {
      message:
        'responseTargetMinutes is the normal target: do not give both with different values.',
    },
  );
export type SetInboxClockSettingsRequest = z.infer<typeof SetInboxClockSettingsRequest>;

/** The old settings DTO plus the three targets and the clock kind of urgent. `responseTargetMinutes` = the normal target. */
export interface InboxClockSettingsDto extends InboxSettingsDto {
  urgentTargetMinutes: number;
  normalTargetMinutes: number;
  lowTargetMinutes: number;
  /** false (the default): urgent counts working time like the others. true: it counts round the clock. */
  urgentRoundTheClock: boolean;
}

/** A person marks a message urgent, normal or low (anyone who may reply, and the assigner). */
export const SetInboxPriorityRequest = z.object({
  socialAccountId: z.uuid(),
  engineMessageId: z.string().trim().min(1).max(200),
  priority: z.enum(INBOX_PRIORITIES),
});
export type SetInboxPriorityRequest = z.infer<typeof SetInboxPriorityRequest>;

export interface InboxPriorityDto {
  socialAccountId: string;
  engineMessageId: string;
  priority: InboxPriority;
  setBy: string | null;
  setByName: string | null;
  setAt: string | null;
  /** The new due time, from the time the message arrived. */
  dueAt: string;
}

/** The inbox list row with the clock fields. The old fields are all kept. */
export interface InboxClockMessageDto extends InboxMessageDto {
  priority: InboxPriority;
  prioritySetBy: string | null;
  prioritySetAt: string | null;
  /** 0 = on time; 1 at 100% of the target, 2 at 150%, 3 at 200% (sheet E-06). 0 once answered. */
  escalationLevel: number;
  /** Handed on twice: the Digital Marketing Manager has it. */
  needsManager: boolean;
  /** How many times a person handed the message on to someone else. */
  reassignmentCount: number;
}

/** Messages that reached 200% of their target in one month: the count for the monthly report (sheet E-06). */
export interface InboxMissReportDto {
  companyId: string;
  /** `YYYY-MM`, in the company's working-hours time zone. */
  month: string;
  misses: number;
}

export const InboxMissesQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  companyId: z.uuid().optional(),
});
export type InboxMissesQuery = z.infer<typeof InboxMissesQuery>;

import type { InboxPriority } from '@dcc/contracts';
import {
  DEFAULT_CALENDAR,
  dueAt as clockDueAt,
  elapsedMinutes,
  escalationLevel,
  INBOX_LADDER,
  type ClockKind,
  type WorkingCalendar,
} from '../shared/working-time';

/**
 * H-14: response-time tracking for one inbox message, computed against the company's target.
 * Pure on purpose, so the boundaries are tested without a database.
 *
 *  - No target (null): there is no due time and nothing is ever overdue. There is no default target.
 *  - A reply sent through DCC has a recorded time: the response is overdue when it took longer than the target.
 *  - A message the engine reports as replied with no time of ours (answered outside DCC) is never called overdue:
 *    DCC cannot know how long it took, and it does not guess.
 *  - Otherwise it is unanswered, and overdue once the due time has passed.
 *
 * Round 2 (sheet E): the due time is `target` minutes on a clock. `clock` is 'working' (Monday to Saturday, the
 * company's calendar) or 'continuous'; it defaults to 'continuous' so a caller that gives no calendar keeps the
 * old plain-minutes meaning. The inbox service passes the working clock for every priority except an urgent
 * message of a company that counts urgent round the clock.
 */
export interface ResponseTracking {
  /** receivedAt plus the target; null when the company has no target. */
  dueAt: Date | null;
  /** Whole seconds from receipt to the first reply sent through DCC; null when there is none. */
  responseSeconds: number | null;
  overdue: boolean;
}

export function trackResponse(input: {
  receivedAt: Date;
  firstResponseAt: Date | null;
  replied: boolean;
  targetMinutes: number | null;
  now: Date;
  clock?: ClockKind;
  calendar?: WorkingCalendar;
}): ResponseTracking {
  const { receivedAt, firstResponseAt, replied, targetMinutes, now } = input;
  const dueAt =
    targetMinutes === null
      ? null
      : clockDueAt(receivedAt, targetMinutes, input.clock ?? 'continuous', input.calendar);
  const responseSeconds = firstResponseAt
    ? Math.max(0, Math.round((firstResponseAt.getTime() - receivedAt.getTime()) / 1000))
    : null;
  if (dueAt === null) return { dueAt, responseSeconds, overdue: false };
  if (firstResponseAt) return { dueAt, responseSeconds, overdue: firstResponseAt > dueAt };
  if (replied) return { dueAt, responseSeconds, overdue: false };
  return { dueAt, responseSeconds, overdue: now > dueAt };
}

/** The targets of a company, in minutes, and how its urgent clock counts. */
export interface InboxTargets {
  urgent: number;
  normal: number;
  low: number;
  urgentRoundTheClock: boolean;
}

/** Which target and which clock a message of this priority runs on. Never restarted by an assignment. */
export function clockFor(
  priority: InboxPriority,
  targets: InboxTargets,
): { targetMinutes: number; clock: ClockKind } {
  return {
    targetMinutes: targets[priority],
    clock: priority === 'urgent' && targets.urgentRoundTheClock ? 'continuous' : 'working',
  };
}

/**
 * Escalation level of an UNANSWERED message (sheet E-06): 0 below 100% of the target, 1 from 100%, 2 from 150%,
 * 3 from 200%. An answered message is 0: the ladder only runs while someone is still owed a reply.
 */
export function inboxEscalationLevel(input: {
  receivedAt: Date;
  priority: InboxPriority;
  targets: InboxTargets;
  answered: boolean;
  now: Date;
  calendar?: WorkingCalendar;
}): number {
  if (input.answered) return 0;
  const { targetMinutes, clock } = clockFor(input.priority, input.targets);
  const elapsed = elapsedMinutes(
    input.receivedAt,
    input.now,
    clock,
    input.calendar ?? DEFAULT_CALENDAR,
  );
  return escalationLevel(elapsed, targetMinutes, INBOX_LADDER);
}

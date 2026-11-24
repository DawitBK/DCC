/**
 * H-14: response-time tracking for one inbox message, computed against the company's target.
 * Pure on purpose, so the boundaries are tested without a database.
 *
 *  - No target (null): there is no due time and nothing is ever overdue. There is no default target.
 *  - A reply sent through DCC has a recorded time: the response is overdue when it took longer than the target.
 *  - A message the engine reports as replied with no time of ours (answered outside DCC) is never called overdue:
 *    DCC cannot know how long it took, and it does not guess.
 *  - Otherwise it is unanswered, and overdue once the due time has passed.
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
}): ResponseTracking {
  const { receivedAt, firstResponseAt, replied, targetMinutes, now } = input;
  const dueAt =
    targetMinutes === null ? null : new Date(receivedAt.getTime() + targetMinutes * 60_000);
  const responseSeconds = firstResponseAt
    ? Math.max(0, Math.round((firstResponseAt.getTime() - receivedAt.getTime()) / 1000))
    : null;
  if (dueAt === null) return { dueAt, responseSeconds, overdue: false };
  if (firstResponseAt) return { dueAt, responseSeconds, overdue: firstResponseAt > dueAt };
  if (replied) return { dueAt, responseSeconds, overdue: false };
  return { dueAt, responseSeconds, overdue: now > dueAt };
}

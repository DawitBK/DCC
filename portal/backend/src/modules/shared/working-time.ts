/**
 * Working time (Round 2, sheet C1-09, C1-10 and E-12). Pure on purpose: every boundary is tested
 * without a database, and the escalation clocks of the inbox, the approvals and the post-incident
 * review all count with it.
 *
 * A calendar is a weekly pattern in the company's LOCAL time (Ethiopia is UTC+3 all year, no summer
 * time), plus a list of public holidays. Default (ASSUMPTION ASM-24): Monday to Saturday, 08:30 to
 * 17:30, no lunch break taken out, no holidays until the company lists them.
 * Day numbers follow JavaScript: 0 = Sunday ... 6 = Saturday.
 */
export interface WorkingCalendar {
  workDays: readonly number[];
  /** Minutes after local midnight when the working day starts (08:30 = 510). */
  startMinute: number;
  /** Minutes after local midnight when it ends, exclusive (17:30 = 1050). */
  endMinute: number;
  /** Local time minus UTC, in minutes (Ethiopia +180). */
  utcOffsetMinutes: number;
  /** Public holidays as local dates, `YYYY-MM-DD`. */
  holidays: readonly string[];
}

export const DEFAULT_CALENDAR: WorkingCalendar = {
  workDays: [1, 2, 3, 4, 5, 6],
  startMinute: 8 * 60 + 30,
  endMinute: 17 * 60 + 30,
  utcOffsetMinutes: 180,
  holidays: [],
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** A calendar with no working day at all cannot count anything; never loop for ever. */
const MAX_DAYS = 800;

/** How a clock counts: only inside working time, or round the clock (crisis, urgent where agreed). */
export type ClockKind = 'working' | 'continuous';

interface Local {
  /** Start of the local day, as a UTC instant. */
  dayStart: number;
  dow: number;
  key: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function localDay(ms: number, cal: WorkingCalendar): Local {
  const shifted = ms + cal.utcOffsetMinutes * MINUTE;
  const dayIndex = Math.floor(shifted / DAY);
  const dayStart = dayIndex * DAY - cal.utcOffsetMinutes * MINUTE;
  const d = new Date(dayIndex * DAY);
  return {
    dayStart,
    dow: (((dayIndex + 4) % 7) + 7) % 7, // 1970-01-01 was a Thursday
    key: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
  };
}

function isWorkingDay(l: Local, cal: WorkingCalendar): boolean {
  return cal.workDays.includes(l.dow) && !cal.holidays.includes(l.key);
}

function assertUsable(cal: WorkingCalendar): void {
  if (cal.workDays.length === 0) throw new Error('The working calendar has no working day.');
  if (cal.endMinute <= cal.startMinute)
    throw new Error('The working day must end after it starts.');
}

/** Is this instant inside working time? */
export function isWorkingInstant(at: Date, cal: WorkingCalendar = DEFAULT_CALENDAR): boolean {
  assertUsable(cal);
  const l = localDay(at.getTime(), cal);
  if (!isWorkingDay(l, cal)) return false;
  const minute = (at.getTime() - l.dayStart) / MINUTE;
  return minute >= cal.startMinute && minute < cal.endMinute;
}

/** The first working instant at or after `at`. */
export function nextWorkingStart(at: Date, cal: WorkingCalendar = DEFAULT_CALENDAR): Date {
  assertUsable(cal);
  let ms = at.getTime();
  for (let i = 0; i < MAX_DAYS; i += 1) {
    const l = localDay(ms, cal);
    if (isWorkingDay(l, cal)) {
      const start = l.dayStart + cal.startMinute * MINUTE;
      const end = l.dayStart + cal.endMinute * MINUTE;
      if (ms < start) return new Date(start);
      if (ms < end) return new Date(ms);
    }
    ms = l.dayStart + DAY; // the next local midnight
  }
  throw new Error('No working time found within the search window.');
}

/** `at` plus `minutes` of working time (a message that arrives at night starts counting next morning). */
export function addWorkingMinutes(
  at: Date,
  minutes: number,
  cal: WorkingCalendar = DEFAULT_CALENDAR,
): Date {
  if (minutes < 0) throw new Error('minutes must not be negative');
  let t = nextWorkingStart(at, cal).getTime();
  let remaining = minutes;
  for (let i = 0; i < MAX_DAYS; i += 1) {
    const l = localDay(t, cal);
    const end = l.dayStart + cal.endMinute * MINUTE;
    const available = (end - t) / MINUTE;
    if (remaining <= available) return new Date(t + remaining * MINUTE);
    remaining -= available;
    t = nextWorkingStart(new Date(end), cal).getTime();
  }
  throw new Error('The target is too long for the working calendar.');
}

/** Minutes of working time between two instants (0 when `to` is not after `from`). */
export function workingMinutesBetween(
  from: Date,
  to: Date,
  cal: WorkingCalendar = DEFAULT_CALENDAR,
): number {
  assertUsable(cal);
  if (to <= from) return 0;
  let total = 0;
  let cursor = from.getTime();
  const stop = to.getTime();
  for (let i = 0; i < MAX_DAYS * 4 && cursor < stop; i += 1) {
    const l = localDay(cursor, cal);
    if (isWorkingDay(l, cal)) {
      const a = Math.max(cursor, l.dayStart + cal.startMinute * MINUTE);
      const b = Math.min(stop, l.dayStart + cal.endMinute * MINUTE);
      if (b > a) total += (b - a) / MINUTE;
    }
    cursor = l.dayStart + DAY;
  }
  return total;
}

/** The end of the working day that is `days` business days after the day of `at` (`days` = 0: today's end, or the next working day's). */
export function endOfBusinessDays(
  at: Date,
  days: number,
  cal: WorkingCalendar = DEFAULT_CALENDAR,
): Date {
  assertUsable(cal);
  if (days < 0) throw new Error('days must not be negative');
  let l = localDay(at.getTime(), cal);
  let ms = l.dayStart;
  let left = days;
  // Step to a working day first so that "0 days" always ends on one.
  for (let i = 0; i < MAX_DAYS; i += 1) {
    l = localDay(ms, cal);
    if (isWorkingDay(l, cal)) {
      if (left === 0) return new Date(l.dayStart + cal.endMinute * MINUTE);
      left -= 1;
    }
    ms = l.dayStart + DAY;
  }
  throw new Error('No working day found within the search window.');
}

/** Minutes that have passed on a clock: working time, or plain elapsed time. */
export function elapsedMinutes(
  from: Date,
  now: Date,
  clock: ClockKind,
  cal: WorkingCalendar = DEFAULT_CALENDAR,
): number {
  if (now <= from) return 0;
  return clock === 'continuous'
    ? (now.getTime() - from.getTime()) / MINUTE
    : workingMinutesBetween(from, now, cal);
}

/** The instant a clock of `minutes` that started at `from` runs out. */
export function dueAt(
  from: Date,
  minutes: number,
  clock: ClockKind,
  cal: WorkingCalendar = DEFAULT_CALENDAR,
): Date {
  return clock === 'continuous'
    ? new Date(from.getTime() + minutes * MINUTE)
    : addWorkingMinutes(from, minutes, cal);
}

/**
 * The escalation ladder shared by the inbox and the approvals (sheet C1-11, E-06): level 0 below 50%
 * of the limit, 1 from 50% (reminder), 2 from 100% (stand-in / backup), 3 from 150% (the person
 * escalated to), 4 from 200% (the Marketing & Communications Manager and the monthly report).
 * The inbox starts at 100% (its first level is the reminder at 100%): pass `ladder`.
 */
export const APPROVAL_LADDER = [0.5, 1, 1.5, 2] as const;
export const INBOX_LADDER = [1, 1.5, 2] as const;

export function escalationLevel(
  elapsed: number,
  limitMinutes: number,
  ladder: readonly number[],
): number {
  if (limitMinutes <= 0) return ladder.length;
  let level = 0;
  for (const step of ladder) if (elapsed >= step * limitMinutes) level += 1;
  return level;
}

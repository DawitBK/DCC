import { describe, expect, it } from 'vitest';
import {
  addWorkingMinutes,
  dueAt,
  elapsedMinutes,
  endOfBusinessDays,
  escalationLevel,
  isWorkingInstant,
  nextWorkingStart,
  workingMinutesBetween,
  APPROVAL_LADDER,
  INBOX_LADDER,
  DEFAULT_CALENDAR,
  type WorkingCalendar,
} from './working-time';

// Local time is UTC+3. Helper: a local wall-clock time as a UTC Date.
const local = (iso: string) => new Date(new Date(`${iso}:00Z`).getTime() - 3 * 3600_000);
const show = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 16);

// 2026-11-23 is a Monday, 2026-11-28 a Saturday, 2026-11-29 a Sunday.
describe('working time (Mon-Sat 08:30-17:30, UTC+3)', () => {
  it('knows what is working time', () => {
    expect(isWorkingInstant(local('2026-11-23T08:29'))).toBe(false);
    expect(isWorkingInstant(local('2026-11-23T08:30'))).toBe(true);
    expect(isWorkingInstant(local('2026-11-23T17:29'))).toBe(true);
    expect(isWorkingInstant(local('2026-11-23T17:30'))).toBe(false);
    expect(isWorkingInstant(local('2026-11-28T10:00'))).toBe(true); // Saturday counts (C1-10)
    expect(isWorkingInstant(local('2026-11-29T10:00'))).toBe(false); // Sunday does not
  });

  it('moves a night or Sunday arrival to the next working start', () => {
    expect(show(nextWorkingStart(local('2026-11-23T20:00')))).toBe('2026-11-24T08:30');
    expect(show(nextWorkingStart(local('2026-11-23T06:00')))).toBe('2026-11-23T08:30');
    expect(show(nextWorkingStart(local('2026-11-28T18:00')))).toBe('2026-11-30T08:30');
    expect(show(nextWorkingStart(local('2026-11-23T10:00')))).toBe('2026-11-23T10:00');
  });

  it('adds working minutes across the end of a day, a Sunday and a holiday', () => {
    expect(show(addWorkingMinutes(local('2026-11-23T10:00'), 60))).toBe('2026-11-23T11:00');
    // 4 working hours from 16:00 Monday: 1.5 h Monday, 2.5 h Tuesday morning
    expect(show(addWorkingMinutes(local('2026-11-23T16:00'), 240))).toBe('2026-11-24T11:00');
    // A message on Saturday 17:00: 30 min left, then Sunday off, the rest on Monday
    expect(show(addWorkingMinutes(local('2026-11-28T17:00'), 120))).toBe('2026-11-30T10:00');
    // Arrives at night: the clock starts at 08:30 the next morning
    expect(show(addWorkingMinutes(local('2026-11-23T22:00'), 60))).toBe('2026-11-24T09:30');
    const withHoliday: WorkingCalendar = { ...DEFAULT_CALENDAR, holidays: ['2026-11-24'] };
    expect(show(addWorkingMinutes(local('2026-11-23T17:00'), 60, withHoliday))).toBe(
      '2026-11-25T09:00',
    );
  });

  it('lands exactly on the end of a day without spilling over', () => {
    expect(show(addWorkingMinutes(local('2026-11-23T16:30'), 60))).toBe('2026-11-23T17:30');
    expect(show(addWorkingMinutes(local('2026-11-23T08:30'), 540))).toBe('2026-11-23T17:30');
  });

  it('counts working minutes between two instants', () => {
    expect(workingMinutesBetween(local('2026-11-23T10:00'), local('2026-11-23T11:30'))).toBe(90);
    expect(workingMinutesBetween(local('2026-11-23T16:30'), local('2026-11-24T09:30'))).toBe(120);
    expect(workingMinutesBetween(local('2026-11-28T17:00'), local('2026-11-30T09:30'))).toBe(90);
    expect(workingMinutesBetween(local('2026-11-23T18:00'), local('2026-11-23T23:00'))).toBe(0);
    expect(workingMinutesBetween(local('2026-11-24T10:00'), local('2026-11-23T10:00'))).toBe(0);
  });

  it('addWorkingMinutes and workingMinutesBetween agree', () => {
    for (const start of ['2026-11-23T07:00', '2026-11-23T12:15', '2026-11-28T16:45']) {
      for (const minutes of [1, 60, 240, 1440, 2880]) {
        const from = local(start);
        const end = addWorkingMinutes(from, minutes);
        expect(workingMinutesBetween(from, end)).toBe(minutes);
      }
    }
  });

  it('ends a number of business days later', () => {
    // Five business days after Monday 23 Nov: Tue, Wed, Thu, Fri, Sat -> Saturday 28 Nov 17:30
    expect(show(endOfBusinessDays(local('2026-11-23T12:00'), 5))).toBe('2026-11-28T17:30');
    // From Saturday: Mon, Tue, Wed, Thu, Fri -> Friday 4 Dec
    expect(show(endOfBusinessDays(local('2026-11-28T12:00'), 5))).toBe('2026-12-04T17:30');
    // From a Sunday, "0 days" is the end of Monday
    expect(show(endOfBusinessDays(local('2026-11-29T12:00'), 0))).toBe('2026-11-30T17:30');
  });

  it('a continuous clock ignores the calendar', () => {
    expect(show(dueAt(local('2026-11-29T23:00'), 60, 'continuous'))).toBe('2026-11-30T00:00');
    expect(elapsedMinutes(local('2026-11-29T23:00'), local('2026-11-30T00:10'), 'continuous')).toBe(
      70,
    );
    expect(elapsedMinutes(local('2026-11-29T23:00'), local('2026-11-30T00:10'), 'working')).toBe(0);
  });

  it('refuses a calendar that cannot count', () => {
    expect(() => nextWorkingStart(new Date(), { ...DEFAULT_CALENDAR, workDays: [] })).toThrow(
      /no working day/,
    );
    expect(() =>
      nextWorkingStart(new Date(), { ...DEFAULT_CALENDAR, startMinute: 600, endMinute: 600 }),
    ).toThrow(/end after/);
  });
});

describe('escalation ladder', () => {
  it('approvals: 50%, 100%, 150%, 200%', () => {
    const level = (m: number) => escalationLevel(m, 100, APPROVAL_LADDER);
    expect([0, 49, 50, 99, 100, 149, 150, 199, 200, 900].map(level)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });
  it('inbox: 100%, 150%, 200%', () => {
    const level = (m: number) => escalationLevel(m, 60, INBOX_LADDER);
    expect([0, 59, 60, 89, 90, 119, 120, 500].map(level)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

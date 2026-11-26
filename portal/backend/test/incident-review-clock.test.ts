import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR, type WorkingCalendar } from '../src/modules/shared/working-time';
import { reviewDueAt, reviewReminderAt } from '../src/modules/incidents/incident-review.service';

/** D2-23: the post-incident review is due 5 business days after the incident was first marked resolved. Local time is UTC+3. */
describe('post-incident review clock (business days)', () => {
  // 2026-03-04 is a Wednesday. 10:00 local = 07:00 UTC.
  const wednesday = new Date('2026-03-04T07:00:00Z');
  const iso = (d: Date) => d.toISOString();

  it('counts Saturday as a business day and skips Sunday: Wednesday + 5 = next Tuesday, 17:30 local', () => {
    // Thu 1, Fri 2, Sat 3, (Sun skipped), Mon 4, Tue 5
    expect(iso(reviewDueAt(wednesday, DEFAULT_CALENDAR))).toBe('2026-03-10T14:30:00.000Z');
  });

  it('the reminder is the end of the business day before the due day', () => {
    expect(iso(reviewReminderAt(wednesday, DEFAULT_CALENDAR))).toBe('2026-03-09T14:30:00.000Z');
  });

  it('a public holiday is skipped as well', () => {
    const holiday: WorkingCalendar = { ...DEFAULT_CALENDAR, holidays: ['2026-03-09'] };
    // Thu 1, Fri 2, Sat 3, (Sun, Mon holiday skipped), Tue 4, Wed 5
    expect(iso(reviewDueAt(wednesday, holiday))).toBe('2026-03-11T14:30:00.000Z');
    expect(iso(reviewReminderAt(wednesday, holiday))).toBe('2026-03-10T14:30:00.000Z');
  });

  it('resolved on a Sunday: the first business day (Monday) is day 0', () => {
    const sunday = new Date('2026-03-08T09:00:00Z');
    // Mon 0, Tue 1, Wed 2, Thu 3, Fri 4, Sat 5
    expect(iso(reviewDueAt(sunday, DEFAULT_CALENDAR))).toBe('2026-03-14T14:30:00.000Z');
  });

  it('resolved at night counts the local day it falls on (23:00 local Wednesday is still Wednesday)', () => {
    const night = new Date('2026-03-04T20:00:00Z'); // 23:00 local, Wednesday
    expect(iso(reviewDueAt(night, DEFAULT_CALENDAR))).toBe('2026-03-10T14:30:00.000Z');
  });

  it('a calendar without Saturday moves the due time over the weekend', () => {
    const monToFri: WorkingCalendar = { ...DEFAULT_CALENDAR, workDays: [1, 2, 3, 4, 5] };
    // Thu 1, Fri 2, Mon 3, Tue 4, Wed 5
    expect(iso(reviewDueAt(wednesday, monToFri))).toBe('2026-03-11T14:30:00.000Z');
  });
});

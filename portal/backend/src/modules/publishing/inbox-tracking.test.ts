import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../shared/working-time';
import { clockFor, inboxEscalationLevel, trackResponse, type InboxTargets } from './inbox-tracking';

const received = new Date('2026-12-01T09:00:00Z');
const at = (minutes: number) => new Date(received.getTime() + minutes * 60_000);

describe('trackResponse', () => {
  it('has no due time and is never overdue without a target', () => {
    const open = trackResponse({
      receivedAt: received,
      firstResponseAt: null,
      replied: false,
      targetMinutes: null,
      now: at(100_000),
    });
    expect(open).toEqual({ dueAt: null, responseSeconds: null, overdue: false });
    const answered = trackResponse({
      receivedAt: received,
      firstResponseAt: at(5000),
      replied: true,
      targetMinutes: null,
      now: at(6000),
    });
    expect(answered).toEqual({ dueAt: null, responseSeconds: 300_000, overdue: false });
  });

  it('an unanswered message is overdue only after the due time', () => {
    const base = { receivedAt: received, firstResponseAt: null, replied: false, targetMinutes: 30 };
    expect(trackResponse({ ...base, now: at(29) })).toMatchObject({ overdue: false });
    // exactly on the due time is still in time
    expect(trackResponse({ ...base, now: at(30) })).toMatchObject({ overdue: false });
    expect(trackResponse({ ...base, now: new Date(at(30).getTime() + 1) })).toMatchObject({
      overdue: true,
      dueAt: at(30),
    });
  });

  it('a recorded reply is judged by how long it took, not by the clock', () => {
    const base = { receivedAt: received, replied: true, targetMinutes: 30, now: at(10_000) };
    expect(trackResponse({ ...base, firstResponseAt: at(30) })).toEqual({
      dueAt: at(30),
      responseSeconds: 1800,
      overdue: false,
    });
    expect(trackResponse({ ...base, firstResponseAt: at(31) })).toMatchObject({
      responseSeconds: 1860,
      overdue: true,
    });
  });

  it('a message answered outside DCC has no response time and is never called overdue', () => {
    expect(
      trackResponse({
        receivedAt: received,
        firstResponseAt: null,
        replied: true,
        targetMinutes: 1,
        now: at(10_000),
      }),
    ).toEqual({ dueAt: at(1), responseSeconds: null, overdue: false });
  });

  it('never reports a negative response time (clock skew between engine and DCC)', () => {
    expect(
      trackResponse({
        receivedAt: received,
        firstResponseAt: at(-2),
        replied: true,
        targetMinutes: 30,
        now: at(10),
      }).responseSeconds,
    ).toBe(0);
  });
});

// Round 2: the clock counts working time (Monday to Saturday 08:30 to 17:30, UTC+3).
describe('the working-hours clock', () => {
  const targets: InboxTargets = { urgent: 60, normal: 240, low: 1440, urgentRoundTheClock: false };
  const tuesday0830 = new Date('2026-12-01T05:30:00Z'); // 08:30 local
  const min = (from: Date, minutes: number) => new Date(from.getTime() + minutes * 60_000);

  it('picks the target of the priority, and a working clock unless urgent runs round the clock', () => {
    expect(clockFor('urgent', targets)).toEqual({ targetMinutes: 60, clock: 'working' });
    expect(clockFor('normal', targets)).toEqual({ targetMinutes: 240, clock: 'working' });
    expect(clockFor('low', targets)).toEqual({ targetMinutes: 1440, clock: 'working' });
    expect(clockFor('urgent', { ...targets, urgentRoundTheClock: true })).toEqual({
      targetMinutes: 60,
      clock: 'continuous',
    });
    // Only urgent has the switch.
    expect(clockFor('low', { ...targets, urgentRoundTheClock: true }).clock).toBe('working');
  });

  it('a message at night is due the next working morning, counted from 08:30', () => {
    const night = new Date('2026-12-01T18:00:00Z'); // Tuesday 21:00 local
    const t = trackResponse({
      receivedAt: night,
      firstResponseAt: null,
      replied: false,
      targetMinutes: 240,
      clock: 'working',
      calendar: DEFAULT_CALENDAR,
      now: min(night, 60),
    });
    expect(t.dueAt).toEqual(new Date('2026-12-02T09:30:00Z')); // Wednesday 12:30 local
    expect(t.overdue).toBe(false);
  });

  it('is not overdue overnight, and is overdue once the working minutes are used', () => {
    const base = {
      receivedAt: min(tuesday0830, 8 * 60), // Tuesday 16:30 local: 60 working minutes left that day
      firstResponseAt: null,
      replied: false,
      targetMinutes: 240,
      clock: 'working' as const,
      calendar: DEFAULT_CALENDAR,
    };
    // 17:30 local the same day, and the middle of the night: 60 of 240 minutes used.
    expect(trackResponse({ ...base, now: min(base.receivedAt, 14 * 60) }).overdue).toBe(false);
    // Wednesday 11:30 local: 60 + 180 = 240 used. On the due time exactly is still in time.
    const due = new Date('2026-12-02T08:30:00Z'); // Wednesday 11:30 local
    expect(trackResponse({ ...base, now: due }).dueAt).toEqual(due);
    expect(trackResponse({ ...base, now: due }).overdue).toBe(false);
    expect(trackResponse({ ...base, now: min(due, 1) }).overdue).toBe(true);
  });

  it('the ladder is 0 below 100%, then 1, 2 and 3 at 100%, 150% and 200% of the target', () => {
    const level = (
      afterMinutes: number,
      extra: Partial<Parameters<typeof inboxEscalationLevel>[0]> = {},
    ) =>
      inboxEscalationLevel({
        receivedAt: tuesday0830,
        priority: 'normal',
        targets,
        answered: false,
        now: min(tuesday0830, afterMinutes),
        calendar: DEFAULT_CALENDAR,
        ...extra,
      });
    expect(level(0)).toBe(0);
    expect(level(239)).toBe(0);
    expect(level(240)).toBe(1);
    expect(level(359)).toBe(1);
    expect(level(360)).toBe(2);
    expect(level(479)).toBe(2);
    expect(level(480)).toBe(3);
    expect(level(5000)).toBe(3);
    // An answered message is back to 0.
    expect(level(480, { answered: true })).toBe(0);
    // Urgent uses its own target (60): level 1 after one working hour, level 3 after two.
    expect(level(60, { priority: 'urgent' })).toBe(1);
    expect(level(120, { priority: 'urgent' })).toBe(3);
  });

  it('the night does not count towards the ladder, round the clock it does', () => {
    const afternoon = new Date('2026-12-01T13:30:00Z'); // 16:30 local, 60 working minutes left today
    const inputs = {
      receivedAt: afternoon,
      priority: 'urgent' as const,
      answered: false,
      calendar: DEFAULT_CALENDAR,
      now: new Date('2026-12-01T22:00:00Z'), // 01:00 the next morning local, 8.5 hours later
    };
    // Working: 60 minutes used in the day = 100% of an hour, and nothing counted since.
    expect(inboxEscalationLevel({ ...inputs, targets })).toBe(1);
    expect(
      inboxEscalationLevel({ ...inputs, targets: { ...targets, urgentRoundTheClock: true } }),
    ).toBe(3);
  });
});

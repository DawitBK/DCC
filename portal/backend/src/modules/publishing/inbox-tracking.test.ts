import { describe, expect, it } from 'vitest';
import { trackResponse } from './inbox-tracking';

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

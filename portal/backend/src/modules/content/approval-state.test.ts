import { describe, expect, it } from 'vitest';
import { APPROVAL_VALIDITY_DAYS } from '@dcc/contracts';
import { escalationLevel } from '../shared/working-time';
import {
  CRISIS_LADDER,
  approvalIsPast,
  effectiveState,
  emergencyConfirmDue,
  ladderFor,
  ruleFields,
  usableApproval,
  validUntilOf,
  type RuleRow,
} from './approval-state';
import { APPROVAL_LADDER, DEFAULT_CALENDAR } from '../shared/working-time';

const at = (iso: string) => new Date(iso);
const DAY = 24 * 60 * 60 * 1000;

describe('seven-day validity (C1-07)', () => {
  it('lasts exactly seven calendar days from the approval', () => {
    expect(APPROVAL_VALIDITY_DAYS).toBe(7);
    const approved = at('2026-11-26T10:00:00.000Z');
    expect(validUntilOf(approved).toISOString()).toBe('2026-12-03T10:00:00.000Z');
  });

  it('is still valid at exactly seven days and expired one second after', () => {
    const approved = at('2026-11-26T10:00:00.000Z');
    const until = validUntilOf(approved);
    expect(approvalIsPast(until, new Date(until.getTime()))).toBe(false);
    expect(approvalIsPast(until, new Date(until.getTime() - 1_000))).toBe(false);
    expect(approvalIsPast(until, new Date(until.getTime() + 1_000))).toBe(true);
  });

  it('a request with no validity date (never approved) is never "past"', () => {
    expect(approvalIsPast(null, at('2030-01-01T00:00:00Z'))).toBe(false);
  });

  it('the effective state reads an approved request past its validity as expired, others as they are', () => {
    const until = at('2026-12-03T10:00:00.000Z');
    expect(effectiveState({ status: 'approved', valid_until: until }, until)).toBe('approved');
    expect(
      effectiveState({ status: 'approved', valid_until: until }, new Date(until.getTime() + 1_000)),
    ).toBe('expired');
    expect(
      effectiveState({ status: 'pending', valid_until: null }, new Date(until.getTime() + DAY)),
    ).toBe('pending');
    expect(
      effectiveState({ status: 'rejected', valid_until: until }, new Date(until.getTime() + DAY)),
    ).toBe('rejected');
  });
});

describe('which request lets a version be published', () => {
  const now = at('2026-11-30T10:00:00.000Z');
  const row = (status: string, requested: string, validUntil: string | null) => ({
    id: `${status}-${requested}`,
    status,
    requested_at: at(requested),
    valid_until: validUntil ? at(validUntil) : null,
  });

  it('refuses a version whose only request is pending, with the plain reason', () => {
    const r = usableApproval([row('pending', '2026-11-29T00:00:00Z', null)], now);
    expect(r).toMatchObject({ ok: false, expired: false, reason: 'This version is not approved.' });
  });

  it('accepts an approved request inside its seven days', () => {
    const r = usableApproval(
      [row('approved', '2026-11-26T00:00:00Z', '2026-12-03T10:00:00Z')],
      now,
    );
    expect(r.ok).toBe(true);
  });

  it('refuses an approved request past its seven days and says it expired and when', () => {
    const r = usableApproval(
      [row('approved', '2026-11-20T00:00:00Z', '2026-11-27T10:00:00Z')],
      now,
    );
    expect(r).toMatchObject({ ok: false, expired: true });
    expect(!r.ok && r.reason).toContain('expired on 2026-11-27');
    expect(!r.ok && r.reason).toContain('Submit this version for approval again');
  });

  it('refuses a request already stored as expired', () => {
    const r = usableApproval([row('expired', '2026-11-20T00:00:00Z', '2026-11-27T10:00:00Z')], now);
    expect(r).toMatchObject({ ok: false, expired: true });
  });

  it('after an expiry the NEW approved request is the one that counts', () => {
    const r = usableApproval(
      [
        row('expired', '2026-11-20T00:00:00Z', '2026-11-27T10:00:00Z'),
        row('approved', '2026-11-29T00:00:00Z', '2026-12-06T10:00:00Z'),
      ],
      now,
    );
    expect(r.ok && r.request.id).toBe('approved-2026-11-29T00:00:00Z');
  });

  it('after an expiry a new request that is still pending does not count yet', () => {
    const r = usableApproval(
      [
        row('expired', '2026-11-20T00:00:00Z', '2026-11-27T10:00:00Z'),
        row('pending', '2026-11-29T00:00:00Z', null),
      ],
      now,
    );
    expect(r.ok).toBe(false);
  });
});

describe('the ladders', () => {
  it('uses the 50-100-150-200 ladder for ordinary limits and for a working clock', () => {
    expect(ladderFor('working', 24 * 60)).toBe(APPROVAL_LADDER);
    expect(ladderFor('working', 30)).toBe(APPROVAL_LADDER); // a short limit on office hours is not a crisis
    expect(ladderFor('continuous', 24 * 60)).toBe(APPROVAL_LADDER);
  });

  it('uses 25-50-75 for a round-the-clock limit of an hour or less (crisis)', () => {
    expect(ladderFor('continuous', 60)).toBe(CRISIS_LADDER);
    expect(ladderFor('continuous', 30)).toBe(CRISIS_LADDER);
    expect(ladderFor('continuous', 61)).toBe(APPROVAL_LADDER);
  });

  it('a crisis of 60 minutes reaches levels at 15, 30 and 45 minutes', () => {
    const level = (m: number) => escalationLevel(m, 60, CRISIS_LADDER);
    expect([14, 15, 29, 30, 44, 45, 90].map(level)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it('the ordinary ladder reaches levels at 50, 100, 150 and 200 percent', () => {
    const level = (m: number) => escalationLevel(m, 100, APPROVAL_LADDER);
    expect([49, 50, 99, 100, 149, 150, 199, 200].map(level)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });
});

describe('what the screens read from a request', () => {
  const base: RuleRow = {
    status: 'pending',
    requested_at: at('2026-11-23T06:00:00.000Z'), // Monday 09:00 local
    time_limit_hours: 2,
    clock: 'working',
    escalation_level: 0,
    approved_at: null,
    valid_until: null,
    emergency: false,
    emergency_by: null,
    emergency_reason: null,
    emergency_at: null,
    emergency_confirmed_by: null,
    emergency_confirmed_at: null,
  };

  it('a pending request with a limit has a due time counted in working hours, and is overdue after it', () => {
    const early = ruleFields(base, DEFAULT_CALENDAR, at('2026-11-23T07:00:00.000Z'));
    expect(early.dueAt).toBe('2026-11-23T08:00:00.000Z');
    expect(early.overdue).toBe(false);
    const late = ruleFields(base, DEFAULT_CALENDAR, at('2026-11-23T08:00:01.000Z'));
    expect(late.overdue).toBe(true);
  });

  it('a request with no limit has no clock', () => {
    const f = ruleFields({ ...base, time_limit_hours: null }, DEFAULT_CALENDAR, at('2027-01-01Z'));
    expect(f.dueAt).toBeNull();
    expect(f.overdue).toBe(false);
  });

  it('the clock stops once the request is settled', () => {
    const f = ruleFields(
      { ...base, status: 'rejected' },
      DEFAULT_CALENDAR,
      at('2026-12-31T00:00:00.000Z'),
    );
    expect(f.dueAt).toBeNull();
    expect(f.overdue).toBe(false);
  });

  it('an emergency approval shows when its confirmation is due, until someone confirms', () => {
    const emergencyAt = at('2026-11-26T10:00:00.000Z');
    const row: RuleRow = {
      ...base,
      status: 'approved',
      approved_at: emergencyAt,
      valid_until: validUntilOf(emergencyAt),
      emergency: true,
      emergency_by: 'u1',
      emergency_reason: 'x'.repeat(20),
      emergency_at: emergencyAt,
    };
    const open = ruleFields(row, DEFAULT_CALENDAR, at('2026-11-26T12:00:00.000Z'));
    expect(open.emergency).toBe(true);
    expect(open.emergencyConfirmDueAt).toBe(emergencyConfirmDue(emergencyAt).toISOString());
    expect(open.emergencyConfirmDueAt).toBe('2026-11-27T10:00:00.000Z');
    const done = ruleFields(
      { ...row, emergency_confirmed_by: 'u2', emergency_confirmed_at: at('2026-11-26T15:00:00Z') },
      DEFAULT_CALENDAR,
      at('2026-11-26T16:00:00.000Z'),
    );
    expect(done.emergencyConfirmDueAt).toBeNull();
  });

  it('shows validity and expiry of an approved request', () => {
    const approvedAt = at('2026-11-26T10:00:00.000Z');
    const row: RuleRow = {
      ...base,
      status: 'approved',
      approved_at: approvedAt,
      valid_until: validUntilOf(approvedAt),
    };
    const ok = ruleFields(row, DEFAULT_CALENDAR, at('2026-12-03T10:00:00.000Z'));
    expect(ok).toMatchObject({
      approvedAt: '2026-11-26T10:00:00.000Z',
      validUntil: '2026-12-03T10:00:00.000Z',
      expired: false,
    });
    expect(ruleFields(row, DEFAULT_CALENDAR, at('2026-12-03T10:00:01.000Z')).expired).toBe(true);
  });
});

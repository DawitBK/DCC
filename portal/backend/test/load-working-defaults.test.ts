import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..', '..', '..');
const script = resolve(root, 'scripts', 'demo', 'load-working-defaults.mjs');

interface Row {
  key: string;
  approvers: number;
  hours: number;
  clock: string;
  roles: string[];
}

/** `--dry-run` calls nothing and needs no sessions: it prints the rules that would be entered. */
function dryRun(): Row[] {
  const out = execFileSync(process.execPath, [script, '--dry-run'], {
    encoding: 'utf8',
    // No API address and no sessions on purpose: a dry run must not need them.
    env: { PATH: process.env.PATH ?? '' },
  });
  expect(out).toContain('Dry run: nothing is called');
  return out
    .split('\n')
    .filter((l) => /^ {2}\S/.test(l))
    .map((l) => {
      const m = /^ {2}(\S+(?: \S+)?)\s+(\d) approvers?\s+(\d+) h (working|continuous)\s+(.+)$/.exec(
        l,
      );
      if (!m) throw new Error(`Cannot read the dry-run line: ${l}`);
      return {
        key: m[1]!,
        approvers: Number(m[2]),
        hours: Number(m[3]),
        clock: m[4]!,
        roles: m[5]!.split(', '),
      };
    });
}

describe('scripts/demo/load-working-defaults.mjs --dry-run (Round 2 time limits)', () => {
  const rows = dryRun();
  const rule = (key: string) => rows.find((r) => r.key === key)!;

  it('lists the company default and the eleven categories without calling anything', () => {
    expect(rows).toHaveLength(12);
    expect(rows[0]!.key).toBe('(company default)');
  });

  it('gives every rule a time limit: 24 or 48 hours on the office-hours clock, Crisis 1 hour round the clock', () => {
    for (const r of rows.filter((x) => x.key !== 'crisis')) {
      expect([24, 48], r.key).toContain(r.hours);
      expect(r.clock, r.key).toBe('working');
    }
    expect(rule('crisis')).toMatchObject({ hours: 1, clock: 'continuous' });
    for (const key of ['campaign', 'executive', 'financial', 'legal', 'sensitive'])
      expect(rule(key).hours, key).toBe(48);
    for (const key of [
      '(company default)',
      'routine',
      'ads-and-offers',
      'partner-mention',
      'group-announcement',
      'hr-recruitment',
    ])
      expect(rule(key).hours, key).toBe(24);
  });

  it('Crisis needs two approvals now that the emergency path exists (assumption AP-12 lifted)', () => {
    expect(rule('crisis')).toMatchObject({ approvers: 2, roles: ['company_executive'] });
  });

  it('keeps the numbers of approvers of the other categories as they were', () => {
    const two = [
      'ads-and-offers',
      'campaign',
      'group-announcement',
      'executive',
      'financial',
      'legal',
      'sensitive',
    ];
    for (const key of two) expect(rule(key).approvers, key).toBe(2);
    for (const key of ['routine', 'partner-mention', 'hr-recruitment', '(company default)'])
      expect(rule(key).approvers, key).toBe(1);
  });

  it('agrees with the time limits written in the policy page, section 2', () => {
    const page = readFileSync(
      resolve(root, 'docs', 'requirements', 'APPROVAL-AND-PUBLISHING-POLICY.md'),
      'utf8',
    );
    const section = page.split(/^## 2\./m)[1]!.split(/^## 3\./m)[0]!;
    let compared = 0;
    for (const line of section.split('\n')) {
      const key = /\(`([a-z-]+)`\)/.exec(line)?.[1];
      if (!key || !line.startsWith('|')) continue;
      const cells = line.split('|').map((c) => c.trim());
      const limit = cells[cells.length - 2]!;
      const expectedHours =
        /(\d+) office hours/.exec(limit)?.[1] ?? (/1 hour/.test(limit) ? '1' : null);
      expect(expectedHours, `${key}: "${limit}"`).not.toBeNull();
      expect(rule(key).hours, key).toBe(Number(expectedHours));
      expect(rule(key).clock, key).toBe(/24 hours a day/.test(limit) ? 'continuous' : 'working');
      compared += 1;
    }
    expect(compared).toBe(11);
  });
});

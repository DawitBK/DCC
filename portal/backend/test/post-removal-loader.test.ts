import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..', '..', '..');
const script = resolve(root, 'scripts', 'demo', 'load-working-defaults.mjs');

/** Round 3: `--dry-run` also shows who may remove or correct a published post of each category (sheet C2 column I). */
function removers(): Map<string, string[]> {
  const out = execFileSync(process.execPath, [script, '--dry-run'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
  const map = new Map<string, string[]>();
  let key = '';
  for (const line of out.split('\n')) {
    const head = /^ {2}(\S+(?: \S+)?)\s+\d approvers?/.exec(line);
    if (head) key = head[1]!;
    const roles = /^ {6}may remove or correct a published post: (.+)$/.exec(line);
    if (roles) map.set(key, roles[1]!.split(', '));
  }
  return map;
}

describe('scripts/demo/load-working-defaults.mjs --dry-run (Round 3 removal roles)', () => {
  const rows = removers();

  it('shows the removal roles of the company default and every category', () => {
    expect(rows.size).toBe(12);
  });

  it('routine, ads, partner mention and campaign: the Digital Marketing Manager and the company administrator', () => {
    for (const key of ['routine', 'ads-and-offers', 'partner-mention', 'campaign'])
      expect(rows.get(key), key).toEqual(['company_marketing_manager', 'company_admin']);
  });

  it('group announcement, executive, crisis and political: senior management, Group marketing and the administrator', () => {
    for (const key of ['group-announcement', 'executive', 'crisis', 'sensitive'])
      expect(rows.get(key), key).toEqual(['company_executive', 'group_marketing', 'company_admin']);
  });

  it('financial, legal, HR and the default ("other"): senior management and the administrator', () => {
    for (const key of ['financial', 'legal', 'hr-recruitment', '(company default)'])
      expect(rows.get(key), key).toEqual(['company_executive', 'company_admin']);
  });
});

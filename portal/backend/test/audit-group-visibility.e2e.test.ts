import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlanHarness } from './plan-harness';

/**
 * H-18 over HTTP: every write path that produces an event with no company stamps the group it belongs to, and the
 * audit API shows a group-level reader the company-less events of their own group and nobody else's.
 */
describe('audit events with no company: group stamping and visibility (H-18)', () => {
  const h = new PlanHarness();
  const { send, json } = h;
  let g1: string;
  let g2: string;

  const stored = (action: string) =>
    h.query(
      `select id, company_id, group_id, details from audit_events where action = $1 order by id`,
      [action],
    );

  beforeAll(async () => {
    await h.start();
    g1 = h.f.groupId;
    g2 = h.f.group2Id;
    await h.persona('auditor-group1', [{ role: 'auditor', companyId: null, groupId: g1 }]);
    await h.persona('auditor-group2', [{ role: 'auditor', companyId: null, groupId: g2 }]);
    await h.persona('auditor-AB', [
      { role: 'auditor', companyId: h.f.companyA, groupId: g1 },
      { role: 'auditor', companyId: h.f.companyB, groupId: g1 },
    ]);
    await h.persona('creator-A', [
      { role: 'content_creator', companyId: h.f.companyA, groupId: g1 },
    ]);
    // Group-level acts of both groups.
    for (const [who, key] of [
      ['groupAdmin', 'cat-one'],
      ['otherGroupAdmin', 'cat-two'],
    ] as const)
      expect(
        (await send('POST', '/api/content-categories', who, { key, name: `name-${key}` })).status,
      ).toBe(201);
    // A group-level role grant in group 1 (to a person who has signed in).
    const grantee = await h.persona('grantee', []);
    expect(
      (
        await send('POST', '/api/memberships', 'groupAdmin', {
          userId: grantee,
          role: 'auditor',
        })
      ).status,
    ).toBe(201);
    // A denied request by a company-level creator (no audit.read) and a failed one by nobody.
    expect((await send('GET', '/api/audit', 'creator-A')).status).toBe(403);
  });
  afterAll(async () => {
    await h.stop();
  });

  it('a category, a group-level grant and a denied request carry the group of their target or actor', async () => {
    const cats = await stored('content_category.created');
    expect(cats.map((r) => r.group_id).sort()).toEqual([g1, g2].sort());
    expect(cats.every((r) => r.company_id === null)).toBe(true);
    const grant = await stored('access.membership_granted');
    expect(grant).toHaveLength(1);
    expect(grant[0].company_id).toBeNull();
    expect(grant[0].group_id).toBe(g1);
    const denied = await stored('security.access_denied');
    expect(denied.at(-1).group_id).toBe(g1); // creator-A's one group
    expect(denied.at(-1).company_id).toBeNull();
    // the chain still verifies with all of them in it
    expect((await json(await send('GET', '/api/audit/verify', 'auditor-group1'))).ok).toBe(true);
  });

  it('a group-level auditor reads their own group’s company-less events and never the other group’s', async () => {
    const one = await json(await send('GET', '/api/audit?limit=200', 'auditor-group1'));
    const two = await json(await send('GET', '/api/audit?limit=200', 'auditor-group2'));
    const names = (rows: any[]) => rows.filter((e) => e.company_id === null).map((e) => e.details);
    const text1 = JSON.stringify(names(one));
    const text2 = JSON.stringify(names(two));
    expect(text1).toContain('name-cat-one');
    expect(text1).not.toContain('name-cat-two');
    expect(text2).toContain('name-cat-two');
    expect(text2).not.toContain('name-cat-one');
    // the grant (group 1) and the denied request (group 1) are group 1's, not group 2's
    expect(one.some((e: any) => e.action === 'access.membership_granted')).toBe(true);
    expect(one.some((e: any) => e.action === 'security.access_denied')).toBe(true);
    expect(two.some((e: any) => e.action === 'access.membership_granted')).toBe(false);
    expect(two.some((e: any) => e.action === 'security.access_denied')).toBe(false);
    // asking for them by action or target does not widen it
    const byAction = await json(
      await send('GET', '/api/audit?action=content_category.created', 'auditor-group2'),
    );
    expect(byAction).toHaveLength(1);
  });

  it('events that belong to no group (failed sign-ins, old data) are read by no group-level auditor', async () => {
    await h.query(
      `select audit_append(null, null, 'test.groupless', null, null, null, null, null, '{}'::jsonb)`,
    );
    for (const who of ['auditor-group1', 'auditor-group2']) {
      const rows = await json(await send('GET', '/api/audit?action=test.groupless', who));
      expect(rows, who).toEqual([]);
    }
    // not through the export either
    const csv = await (await send('GET', '/api/audit/export?limit=5000', 'auditor-group1')).text();
    expect(csv).not.toContain('test.groupless');
    expect(csv).not.toContain('name-cat-two');
  });

  it('a company-level auditor reads no company-less event, whatever the filter', async () => {
    for (const path of [
      '/api/audit?limit=200',
      '/api/audit?action=content_category.created',
      '/api/audit?action=access.membership_granted',
      '/api/audit?action=security.access_denied',
    ]) {
      const rows = await json(await send('GET', path, 'auditor-AB'));
      expect(
        rows.every((e: any) => e.company_id !== null),
        path,
      ).toBe(true);
    }
  });

  it('an export that covers several companies belongs to the caller’s group, and only that group’s auditors see it', async () => {
    expect((await send('GET', '/api/audit/export', 'auditor-AB')).status).toBe(200);
    const exported = await stored('audit.exported');
    const mine = exported.find((r) => r.company_id === null && r.group_id === g1);
    expect(mine).toBeTruthy();
    const one = await json(await send('GET', '/api/audit?action=audit.exported', 'auditor-group1'));
    expect(one.some((e: any) => e.id === mine.id)).toBe(true);
    const two = await json(await send('GET', '/api/audit?action=audit.exported', 'auditor-group2'));
    expect(two.some((e: any) => e.id === mine.id)).toBe(false);
    // a group-level export is stamped with that group
    expect((await send('GET', '/api/audit/export', 'auditor-group2')).status).toBe(200);
    const after = await stored('audit.exported');
    expect(after.some((r) => r.company_id === null && r.group_id === g2)).toBe(true);
  });
});

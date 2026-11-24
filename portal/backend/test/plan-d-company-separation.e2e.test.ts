import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { ROLE_PERMISSIONS, type Permission } from '@dcc/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_PUBLIC, REQUIRED_PERMISSION } from '../src/platform/authz/decorators';
import { PlanHarness } from './plan-harness';

/**
 * docs/testing/INTEGRATION-TEST-PLAN.md section D (tests 26 to 28), done as attack tests over HTTP against the real
 * database: two companies of one group (A and B) and one company of another group (2). Every person below holds EVERY
 * role that exists at their level, so the permission gate never explains a refusal: only the walls between companies
 * and groups can. Each company holds content in every state, a publication, an incident, a picture, a freeze, an
 * approval policy and an inbox message, all carrying a marker text and known ids.
 */

const NIL_ID = '00000000-0000-4000-8000-000000000000';
// A 1 x 1 pixel PNG, so the upload passes the "what the file really is" check.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface World {
  label: string; // A, B or 2
  groupId: string;
  companyId: string;
  accountId: string;
  channel: string;
  /** Text that appears only in this company's records. */
  marker: string;
  /** Every id that belongs to this company (records, people, memberships). */
  ids: string[];
  itemId: string;
  requestId: string;
  publicationId: string;
  incidentId: string;
  mediaId: string;
  freezeId: string;
  policyId: string;
  brandId: string;
  membershipId: string;
  personaId: string;
  emails: string[];
}

describe('integration plan D: company and group separation (attack tests)', () => {
  const h = new PlanHarness();
  const { send, json } = h;
  const worlds = {} as Record<'A' | 'B' | '2', World>;
  const groupMarkers = { 1: 'PLAN-GROUP-1-category', 2: 'PLAN-GROUP-2-category' } as const;
  const COMPANY_ROLES = [
    'company_admin',
    'company_executive',
    'company_marketing_manager',
    'content_creator',
    'content_reviewer',
    'publisher',
    'auditor',
  ];
  const GROUP_ROLES = ['group_admin', 'group_cto', 'security_admin', 'group_marketing', 'auditor'];

  const seedWorld = async (
    label: World['label'],
    groupId: string,
    companyId: string,
    accountId: string,
    channel: string,
  ): Promise<World> => {
    const inCompany = (role: string) => [{ role, companyId, groupId }];
    const creator = `creator-${label}`;
    await h.persona(creator, inCompany('content_creator'));
    await h.persona(`mgr-${label}`, inCompany('company_marketing_manager'));
    await h.persona(`exec-${label}`, inCompany('company_executive'));
    await h.persona(`admin-${label}`, inCompany('company_admin'));
    const marker = `PLAN-SECRET-${label}`;
    const { item, request } = await h.approvedItem({
      text: `${marker} published post`,
      author: creator,
      approver: `mgr-${label}`,
      companyId,
      accountId,
    });
    const publication = await json(
      await send('POST', `/api/content-items/${item.id}/publish`, `exec-${label}`, {
        socialAccountId: accountId,
      }),
    );
    const waiting = await json(
      await send('POST', '/api/content-items', creator, {
        companyId,
        body: `${marker} waiting for review`,
        targetAccountIds: [accountId],
      }),
    );
    await send('POST', `/api/content-items/${waiting.id}/submit`, creator);
    await send('POST', '/api/content-items', creator, {
      companyId,
      body: `${marker} still a draft`,
      targetAccountIds: [accountId],
    });
    const incident = await json(
      await send('POST', '/api/incidents', `exec-${label}`, {
        companyId,
        title: `${marker} incident`,
        severity: 'high',
      }),
    );
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), `${marker}.png`);
    const media = await json(
      await fetch(`${h.base}/api/media?companyId=${companyId}`, {
        method: 'POST',
        body: form,
        headers: { cookie: h.cookies.get(creator)!, origin: 'http://localhost:7717' },
      }),
    );
    const policy = await json(
      await send('PUT', '/api/approval-policies', `admin-${label}`, {
        companyId,
        requiredApprovals: 1,
        approverRoles: [],
      }),
    );
    const freeze = await json(
      await send('POST', '/api/publishing-freezes', `exec-${label}`, {
        companyId,
        reason: `${marker} freeze`,
      }),
    );
    h.fake.inboxMessages.push({
      engineMessageId: `msg-${label}`,
      engineChannelId: channel,
      kind: 'comment',
      authorName: 'A customer',
      text: `${marker} inbox message`,
      receivedAt: new Date(Date.now() - 60_000),
      engineOperationId: null,
      replied: false,
    });

    const ids = new Set<string>([companyId, accountId]);
    const collect = async (sql: string, values: unknown[]) =>
      (await h.query(sql, values)).forEach((r) => ids.add(r.id as string));
    await collect(`select id from content_items where company_id = $1`, [companyId]);
    await collect(`select id from content_versions where company_id = $1`, [companyId]);
    await collect(`select id from approval_requests where company_id = $1`, [companyId]);
    await collect(`select id from approval_decisions where company_id = $1`, [companyId]);
    await collect(`select id from publications where company_id = $1`, [companyId]);
    await collect(`select id from incidents where company_id = $1`, [companyId]);
    await collect(`select id from brands where company_id = $1`, [companyId]);
    await collect(`select id from memberships where company_id = $1`, [companyId]);
    await collect(`select user_id as id from memberships where company_id = $1`, [companyId]);
    await collect(`select id from content_media where company_id = $1`, [companyId]);
    await collect(`select id from publishing_freezes where company_id = $1`, [companyId]);
    await collect(`select id from approval_policies where company_id = $1`, [companyId]);
    const emails = (
      await h.query(
        `select u.email from users u join memberships m on m.user_id = u.id where m.company_id = $1`,
        [companyId],
      )
    ).map((r) => r.email as string);
    const brand = (
      await h.query(`select id from brands where company_id = $1 limit 1`, [companyId])
    )[0];
    const membership = (
      await h.query(`select id from memberships where company_id = $1 limit 1`, [companyId])
    )[0];
    return {
      label,
      groupId,
      companyId,
      accountId,
      channel,
      marker,
      ids: [...ids],
      itemId: item.id,
      requestId: request.id,
      publicationId: publication.id,
      incidentId: incident.id,
      mediaId: media.id,
      freezeId: freeze.id,
      policyId: policy.id,
      brandId: brand.id,
      membershipId: membership.id,
      personaId: h.userIds.get(creator)!,
      emails,
    };
  };

  beforeAll(async () => {
    await h.start({ a: 'plan-channel-a', b: 'plan-channel-b' });
    const { f } = h;
    // Company 2 (the other group) gets a brand, an account and an engine channel of its own.
    await h.owner(async (db) => {
      const brand = await db.query(
        `insert into brands (company_id, name, slug) values ($1, 'Brand Two', 'brand-two') returning id`,
        [f.company2],
      );
      await db.query(
        `insert into social_accounts (company_id, brand_id, platform, display_name, handle, engine_channel_id)
         values ($1, $2, 'linkedin', 'Two page', '@two', 'plan-channel-2')`,
        [f.company2, brand.rows[0].id],
      );
    });
    const accountTwo = (
      await h.query(`select id from social_accounts where company_id = $1`, [f.company2])
    )[0].id;
    worlds.A = await seedWorld('A', f.groupId, f.companyA, f.accountA, 'plan-channel-a');
    worlds.B = await seedWorld('B', f.groupId, f.companyB, f.accountB, 'plan-channel-b');
    worlds['2'] = await seedWorld('2', f.group2Id, f.company2, accountTwo, 'plan-channel-2');

    // The attackers: everything a person can hold at their level, in exactly one place.
    await h.persona(
      'allA',
      COMPANY_ROLES.map((role) => ({ role, companyId: f.companyA, groupId: f.groupId })),
    );
    await h.persona(
      'allB',
      COMPANY_ROLES.map((role) => ({ role, companyId: f.companyB, groupId: f.groupId })),
    );
    await h.persona(
      'group1',
      GROUP_ROLES.map((role) => ({ role, companyId: null, groupId: f.groupId })),
    );
    await h.persona(
      'group2',
      GROUP_ROLES.map((role) => ({ role, companyId: null, groupId: f.group2Id })),
    );
    // One content category per group (a group-level object).
    expect(
      (
        await send('POST', '/api/content-categories', 'group1', {
          key: 'plan-one',
          name: groupMarkers[1],
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await send('POST', '/api/content-categories', 'group2', {
          key: 'plan-two',
          name: groupMarkers[2],
        })
      ).status,
    ).toBe(201);
  });
  afterAll(async () => {
    await h.stop();
  });

  type Attacker = {
    name: string;
    own: Array<'A' | 'B' | '2'>;
    foreign: Array<'A' | 'B' | '2'>;
    foreignGroup: 1 | 2;
    /** The roles this person holds (all of them at their level). */
    roles: string[];
  };
  const attackers: Attacker[] = [
    { name: 'allA', own: ['A'], foreign: ['B', '2'], foreignGroup: 2, roles: COMPANY_ROLES },
    { name: 'allB', own: ['B'], foreign: ['A', '2'], foreignGroup: 2, roles: COMPANY_ROLES },
    { name: 'group1', own: ['A', 'B'], foreign: ['2'], foreignGroup: 2, roles: GROUP_ROLES },
    { name: 'group2', own: ['2'], foreign: ['A', 'B'], foreignGroup: 1, roles: GROUP_ROLES },
  ];

  /** Snapshot of everything the attacks must not change, per company, as the database holds it. */
  const snapshot = async (w: World) => {
    const tables: Array<[string, string]> = [
      ['companies', 'id'],
      ['brands', 'company_id'],
      ['social_accounts', 'company_id'],
      ['content_items', 'company_id'],
      ['content_versions', 'company_id'],
      ['approval_requests', 'company_id'],
      ['approval_decisions', 'company_id'],
      ['publications', 'company_id'],
      ['incidents', 'company_id'],
      ['memberships', 'company_id'],
      ['publishing_freezes', 'company_id'],
      ['approval_policies', 'company_id'],
      ['content_media', 'company_id'],
    ];
    const out: Record<string, string> = {};
    for (const [table, column] of tables)
      out[table] = (
        await h.query(
          `select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h, count(*)::int as n from ${table} t where t.${column} = $1`,
          [w.companyId],
        )
      )[0].h;
    return out;
  };

  const leaks = (text: string, foreign: World[], foreignGroup: 1 | 2 | null) => {
    const found: string[] = [];
    for (const w of foreign) {
      if (text.includes(w.marker)) found.push(`marker ${w.marker}`);
      for (const id of w.ids) if (text.includes(id)) found.push(`id ${id}`);
      for (const email of w.emails) if (text.includes(email)) found.push(`email ${email}`);
    }
    if (foreignGroup && text.includes(groupMarkers[foreignGroup]))
      found.push(`group marker ${foreignGroup}`);
    return found;
  };

  type Route = {
    method: string;
    path: string;
    permission: Permission | undefined;
    isPublic: boolean;
  };
  const METHODS: Record<number, string> = {
    [RequestMethod.GET]: 'GET',
    [RequestMethod.POST]: 'POST',
    [RequestMethod.PUT]: 'PUT',
    [RequestMethod.DELETE]: 'DELETE',
    [RequestMethod.PATCH]: 'PATCH',
  };
  /** Every route of the application, read from the controllers themselves, so a new endpoint is covered at once. */
  const allRoutes = (): Route[] => {
    const reflect = Reflect as unknown as { getMetadata: (key: string, target: object) => any };
    const found: Route[] = [];
    for (const mod of h.app.get(ModulesContainer).values())
      for (const wrapper of mod.controllers.values()) {
        const controller = wrapper.metatype as { prototype: Record<string, unknown> } | null;
        if (!controller) continue;
        const prefix = String(reflect.getMetadata(PATH_METADATA, controller) ?? '');
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = controller.prototype[name];
          if (typeof handler !== 'function' || name === 'constructor') continue;
          const method = reflect.getMetadata(METHOD_METADATA, handler);
          if (method === undefined) continue;
          found.push({
            method: METHODS[method] ?? String(method),
            path: `/api/${[prefix, String(reflect.getMetadata(PATH_METADATA, handler) ?? '')].join('/')}`
              .replace(/\/+/g, '/')
              .replace(/\/$/, ''),
            permission:
              reflect.getMetadata(REQUIRED_PERMISSION, handler) ??
              reflect.getMetadata(REQUIRED_PERMISSION, controller),
            isPublic: Boolean(
              reflect.getMetadata(IS_PUBLIC, handler) ?? reflect.getMetadata(IS_PUBLIC, controller),
            ),
          });
        }
      }
    return found;
  };
  /** Every GET route that takes no id and is not public. */
  const listRoutes = (): string[] =>
    [
      ...new Set(
        allRoutes()
          .filter((r) => r.method === 'GET' && !r.path.includes(':') && !r.isPublic)
          .map((r) => r.path),
      ),
    ].sort();
  /** The permission a concrete request needs (the route whose pattern it matches). */
  const permissionOf = (method: string, concretePath: string): Permission => {
    const route = allRoutes().find(
      (r) =>
        r.method === method &&
        new RegExp(`^${r.path.replace(/:[A-Za-z]+/g, '[^/]+')}$`).test(concretePath),
    );
    if (!route?.permission) throw new Error(`No permission found for ${method} ${concretePath}`);
    return route.permission;
  };
  const holds = (attacker: { roles: string[] }, permission: Permission) =>
    attacker.roles.some((role) =>
      (ROLE_PERMISSIONS as Record<string, readonly string[]>)[role]?.includes(permission),
    );
  const GATE_MESSAGE = 'You do not have permission to do that.';

  it('D26a: no list or read endpoint shows one company or group anything of another (all four attackers, every list route)', async () => {
    const routes = listRoutes();
    // The routes this sweep must reach: if one disappears from the list the test says so instead of passing on less.
    for (const must of [
      '/api/audit',
      '/api/companies',
      '/api/content-items',
      '/api/approval-requests',
      '/api/social-accounts',
      '/api/incidents',
      '/api/publications',
      '/api/publishing-freezes',
      '/api/notifications',
      '/api/users',
      '/api/approval-policies',
      '/api/content-categories',
      '/api/dashboard',
      '/api/inbox',
      '/api/reports/overview',
    ])
      expect(routes, must).toContain(must);

    const problems: string[] = [];
    for (const attacker of attackers) {
      const foreign = attacker.foreign.map((k) => worlds[k]);
      for (const path of routes) {
        const query = path === '/api/audit' ? '?limit=200' : '';
        const response = await send('GET', `${path}${query}`, attacker.name);
        const text = await response.text();
        if (response.status >= 500)
          problems.push(`${attacker.name} GET ${path}: ${response.status}`);
        // The audit trail's group-level events are checked on their own below (D28c, a known defect).
        const groupMarker = path.startsWith('/api/audit') ? null : attacker.foreignGroup;
        for (const leak of leaks(text, foreign, groupMarker))
          problems.push(`${attacker.name} GET ${path} leaks ${leak}`);
      }
    }
    expect(problems).toEqual([]);
  }, 120_000);

  it("D26b: the same sweep finds the attacker's OWN records (so the checks above are not passing on empty answers)", async () => {
    for (const attacker of attackers) {
      const mine = attacker.own.map((k) => worlds[k]);
      for (const path of [
        '/api/content-items',
        '/api/incidents',
        '/api/social-accounts',
        '/api/publications',
        '/api/inbox',
      ]) {
        const text = await (await send('GET', path, attacker.name)).text();
        for (const w of mine) {
          const expected = {
            '/api/content-items': w.itemId,
            '/api/incidents': w.marker,
            '/api/social-accounts': w.accountId,
            '/api/publications': w.publicationId,
            '/api/inbox': w.marker,
          }[path]!;
          expect(text, `${attacker.name} ${path}`).toContain(expected);
        }
      }
      expect(await (await send('GET', '/api/audit?limit=200', attacker.name)).text()).toContain(
        mine[0]!.companyId,
      );
    }
    // A group-level person sees the categories of their own group only.
    expect(await (await send('GET', '/api/content-categories', 'group1')).text()).toContain(
      groupMarkers[1],
    );
    expect(await (await send('GET', '/api/content-categories', 'group2')).text()).toContain(
      groupMarkers[2],
    );
  });

  it("D26c: another company's records, opened by id, are not found: never forbidden and never the record", async () => {
    const problems: string[] = [];
    for (const attacker of attackers)
      for (const key of attacker.foreign) {
        const w = worlds[key];
        const reads = [
          `/api/content-items/${w.itemId}`,
          `/api/content-items/${w.itemId}/versions`,
          `/api/content-items/${w.itemId}/approval`,
          `/api/incidents/${w.incidentId}`,
          `/api/social-accounts/${w.accountId}/assignments`,
          `/api/media/${w.mediaId}/file`,
          `/api/companies/${w.companyId}/brands`,
        ];
        for (const path of reads) {
          const response = await send('GET', path, attacker.name);
          const text = await response.text();
          if (response.status !== 404)
            problems.push(`${attacker.name} GET ${path}: ${response.status}`);
          if (text.includes(w.marker))
            problems.push(`${attacker.name} GET ${path} returned the record`);
        }
      }
    expect(problems).toEqual([]);
  });

  it("D26d: another company's records cannot be changed by id (404), and creating something in another company is refused", async () => {
    const before = {
      A: await snapshot(worlds.A),
      B: await snapshot(worlds.B),
      '2': await snapshot(worlds['2']),
    };
    const problems: string[] = [];
    for (const attacker of attackers) {
      const ownCreator = h.userIds.get(`creator-${attacker.own[0]}`)!;
      for (const key of attacker.foreign) {
        const w = worlds[key];
        const idCalls: Array<[string, string, unknown?]> = [
          ['PATCH', `/api/content-items/${w.itemId}`, { body: 'changed by an outsider' }],
          ['POST', `/api/content-items/${w.itemId}/submit`],
          ['POST', `/api/content-items/${w.itemId}/publish`, { socialAccountId: w.accountId }],
          ['POST', `/api/approval-requests/${w.requestId}/approve`, {}],
          ['POST', `/api/approval-requests/${w.requestId}/reject`, {}],
          ['POST', `/api/approval-requests/${w.requestId}/review`, { comment: 'outsider comment' }],
          ['POST', `/api/publications/${w.publicationId}/cancel`],
          ['PATCH', `/api/social-accounts/${w.accountId}`, { displayName: 'taken over' }],
          ['PATCH', `/api/social-accounts/${w.accountId}/status`, { status: 'archived' }],
          [
            'PATCH',
            `/api/social-accounts/${w.accountId}/backup-admin`,
            { backupAdminUserId: ownCreator },
          ],
          ['POST', `/api/social-accounts/${w.accountId}/assignments`, { userId: ownCreator }],
          ['DELETE', `/api/social-accounts/${w.accountId}/assignments/${w.personaId}`],
          [
            'PATCH',
            `/api/social-accounts/${w.accountId}/engine-channel`,
            { engineChannelId: null },
          ],
          ['PATCH', `/api/incidents/${w.incidentId}`, { status: 'closed' }],
          ['DELETE', `/api/memberships/${w.membershipId}`],
          ['DELETE', `/api/publishing-freezes/${w.freezeId}`],
          ['DELETE', `/api/approval-policies/${w.policyId}`],
          ['PATCH', `/api/companies/${w.companyId}`, { name: 'taken over' }],
          ['PATCH', `/api/companies/${w.companyId}/brands/${w.brandId}`, { name: 'taken over' }],
        ];
        const createCalls: Array<[string, string, unknown?]> = [
          [
            'POST',
            '/api/content-items',
            { companyId: w.companyId, body: 'planted', targetAccountIds: [w.accountId] },
          ],
          ['POST', '/api/incidents', { companyId: w.companyId, title: 'planted incident' }],
          [
            'POST',
            '/api/social-accounts',
            {
              companyId: w.companyId,
              platform: 'x',
              displayName: 'Planted',
              handle: '@planted',
              ownerUserId: ownCreator,
            },
          ],
          ['POST', '/api/publishing-freezes', { companyId: w.companyId, reason: 'planted freeze' }],
          [
            'PUT',
            '/api/approval-policies',
            { companyId: w.companyId, requiredApprovals: 2, approverRoles: [] },
          ],
          [
            'POST',
            '/api/memberships',
            { userId: ownCreator, companyId: w.companyId, role: 'content_creator' },
          ],
          ['POST', `/api/companies/${w.companyId}/brands`, { name: 'Planted', slug: 'planted' }],
        ];
        // Where the person's roles do not include the permission at all, the permission gate answers 403 before any
        // record is looked at; that is a different wall and is accepted. Where they DO include it, only the wall
        // between companies and groups is left, and it must answer "not found" (403 would confirm the record exists).
        for (const [method, path, body] of idCalls) {
          const response = await send(method, path, attacker.name, body);
          if (holds(attacker, permissionOf(method, path))) {
            if (response.status !== 404)
              problems.push(`${attacker.name} ${method} ${path}: ${response.status}`);
          } else if (response.status !== 403 || (await response.json()).message !== GATE_MESSAGE)
            problems.push(
              `${attacker.name} ${method} ${path}: ${response.status} (expected the gate)`,
            );
        }
        for (const [method, path, body] of createCalls) {
          const response = await send(method, path, attacker.name, body);
          if (![403, 404].includes(response.status))
            problems.push(`${attacker.name} ${method} ${path}: ${response.status}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect({
      A: await snapshot(worlds.A),
      B: await snapshot(worlds.B),
      '2': await snapshot(worlds['2']),
    }).toEqual(before);
  }, 120_000);

  it('D26e: nothing the attackers read or tried shows up as an engine call, and the engine holds no extra post', async () => {
    const posts = [...h.fake.posts.values()];
    expect(posts.every((p) => p.content?.startsWith('PLAN-SECRET-'))).toBe(true);
    expect(h.fake.replies).toEqual([]);
    expect(h.fake.published).toHaveLength(3);
  });

  it('D27: a company administrator cannot grant a role in another company, nor to themselves', async () => {
    const memberships = async () =>
      (await h.query(`select count(*)::int as n from memberships`))[0].n as number;
    const before = await memberships();
    const target = h.userIds.get('creator-B')!;
    // In company B (another company of the same group), and in the other group's company.
    for (const w of [worlds.B, worlds['2']]) {
      const response = await send('POST', '/api/memberships', 'admin-A', {
        userId: target,
        companyId: w.companyId,
        role: 'content_reviewer',
      });
      expect([403, 404], `grant in ${w.label}`).toContain(response.status);
    }
    // A group-level role: only a group administrator may.
    const groupLevel = await send('POST', '/api/memberships', 'admin-A', {
      userId: target,
      role: 'group_admin',
    });
    expect([403, 404]).toContain(groupLevel.status);
    // Themselves, by id and by e-mail, in their own company and elsewhere.
    const self = h.userIds.get('admin-A')!;
    const selfEmail = (await h.query(`select email from users where id = $1`, [self]))[0].email;
    for (const body of [
      { userId: self, companyId: worlds.A.companyId, role: 'company_executive' },
      { email: selfEmail, companyId: worlds.A.companyId, role: 'company_executive' },
      { userId: self, companyId: worlds.B.companyId, role: 'company_admin' },
    ]) {
      const response = await send('POST', '/api/memberships', 'admin-A', body);
      expect([400, 403, 404]).toContain(response.status);
      expect(response.status).not.toBeLessThan(400);
    }
    expect(await memberships()).toBe(before);
  });

  it("D28: an auditor of company A searches and exports only company A's events", async () => {
    await h.persona('auditor-A', [
      { role: 'auditor', companyId: worlds.A.companyId, groupId: h.f.groupId },
    ]);
    const foreign = [worlds.B, worlds['2']];
    const listed = await json(await send('GET', '/api/audit?limit=200', 'auditor-A'));
    expect(listed.length).toBeGreaterThan(10);
    expect(listed.every((e: any) => e.company_id === worlds.A.companyId)).toBe(true);
    expect(leaks(JSON.stringify(listed), foreign, 2)).toEqual([]);

    // Asking for another company's events, or for events about another company's record, finds nothing.
    for (const path of [
      `/api/audit?companyId=${worlds.B.companyId}`,
      `/api/audit?companyId=${worlds['2'].companyId}`,
      `/api/audit?targetId=${worlds.B.itemId}`,
      `/api/audit?targetId=${worlds['2'].publicationId}`,
    ]) {
      const response = await send('GET', path, 'auditor-A');
      expect(response.status, path).toBe(200);
      expect(await json(response), path).toEqual([]);
    }

    // The export is the same search, as a file, and is itself recorded.
    const exported = await send('GET', '/api/audit/export?limit=5000', 'auditor-A');
    expect(exported.status).toBe(200);
    const csv = await exported.text();
    expect(csv.split('\r\n')[0]).toContain('company_id');
    expect(leaks(csv, foreign, 2)).toEqual([]);
    const lines = csv.trim().split('\r\n').slice(1);
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.every((line) => line.includes(`"${worlds.A.companyId}"`))).toBe(true);
    const again = await json(await send('GET', '/api/audit?action=audit.exported', 'auditor-A'));
    expect(again.length).toBeGreaterThanOrEqual(1);

    // A group-level auditor sees their own group's company events (the other group's group-level events: D28c).
    const own = await (await send('GET', '/api/audit?limit=200', 'group2')).text();
    expect(own).toContain(worlds['2'].companyId);
    // ...and no event that belongs to a company of the other group.
    const companyEvents = (await json(await send('GET', '/api/audit?limit=200', 'group2'))).filter(
      (e: any) => e.company_id !== null,
    );
    expect(companyEvents.every((e: any) => e.company_id === worlds['2'].companyId)).toBe(true);
    expect(NIL_ID).toBeTruthy();
  });

  /**
   * FINDING (2026-11-24, this test pass): audit events that belong to no company (company_id null: creating a content
   * category, a group-level role, an export) are visible to a group-level auditor of ANY group. The row-level
   * policy `audit_events_select` allows `company_id is null and cardinality(app_group_ids()) > 0`, and the audit
   * controller adds `company_id is null` for every group-level holder of audit.read; the table has no group column to
   * narrow it by. `it.fails` records the defect: this test passes while the defect exists and starts failing the day
   * it is fixed, which is the moment to turn it into a plain `it`.
   */
  it.fails(
    'D28c (KNOWN DEFECT): a group-level auditor sees none of the group-level audit events of ANOTHER group',
    async () => {
      const text = await (await send('GET', '/api/audit?limit=200', 'group1')).text();
      expect(text).not.toContain(groupMarkers[2]);
      const other = await (await send('GET', '/api/audit?limit=200', 'group2')).text();
      expect(other).not.toContain(groupMarkers[1]);
    },
  );
});

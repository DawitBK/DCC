import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import {
  APPROVAL_REQUEST_STATUSES,
  COMPANY_STATUSES,
  CONTENT_CATEGORY_STATUSES,
  CONTENT_ITEM_STATUSES,
  INCIDENT_CATEGORY_STATUSES,
  INCIDENT_CONTACT_CHANNELS,
  INCIDENT_CONTACT_STATUSES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  NOTIFICATION_EVENT_TYPES,
  PUBLICATION_STATUSES,
  ROLES,
  ROLE_PERMISSIONS,
  SOCIAL_ACCOUNT_STATUSES,
  SOCIAL_PLATFORMS,
  roleAllowedAtScope,
  type Permission,
} from '@dcc/contracts';
import type { InboxMessage } from '@dcc/engine-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_PUBLIC, REQUIRED_PERMISSION } from '../src/platform/authz/decorators';
import { PlanHarness } from './plan-harness';

/**
 * docs/testing/INTEGRATION-TEST-PLAN.md section B (tests 12 to 16), the part that needs no browser: the API, the
 * contracts and the database agree. What the screen shows (labels, hidden buttons, `/dcc` links) stays a browser test.
 */
describe('integration plan B: the API, the contracts and the database agree', () => {
  const h = new PlanHarness();
  const { send, json } = h;
  let groupId: string;
  let companyA: string;
  let accountA: string;

  beforeAll(async () => {
    await h.start();
    ({ groupId, companyA, accountA } = {
      groupId: h.f.groupId,
      companyA: h.f.companyA,
      accountA: h.f.accountA,
    });
  });
  afterAll(async () => {
    await h.stop();
  });

  const inA = (...roles: string[]) => roles.map((role) => ({ role, companyId: companyA, groupId }));
  const chars = (n: number) => 'a'.repeat(n);

  describe('B12: every limit is the same in the API and the database', () => {
    beforeAll(async () => {
      await h.persona('creator', inA('content_creator'));
      await h.persona('manager', inA('company_marketing_manager'));
      await h.persona('exec', inA('company_executive'));
      await h.persona('admin', inA('company_admin'));
      await h.persona('owner', inA('content_creator'));
      await h.persona('groupAdmin2', [{ role: 'group_admin', companyId: null, groupId }]);
    });

    /** At the limit the API accepts and the database keeps every character; one over is a 400 naming the field. */
    const limit = async (opts: {
      what: string;
      attempt: (value: string) => Promise<Response>;
      max: number;
      stored: (response: any) => Promise<string>;
      min?: number;
      shape?: (n: number) => string;
    }) => {
      const make = opts.shape ?? chars;
      const ok = await opts.attempt(make(opts.max));
      expect(ok.status, `${opts.what} at ${opts.max}`).toBeLessThan(300);
      expect((await opts.stored(await ok.json())).length, `${opts.what} stored`).toBe(opts.max);
      const over = await opts.attempt(make(opts.max + 1));
      expect(over.status, `${opts.what} at ${opts.max + 1}`).toBe(400);
      const body = await json(over);
      expect(body.requestId).toBeTruthy();
      expect(body.issues ?? body.message, opts.what).toBeTruthy();
      expect((await opts.attempt('')).status, `${opts.what} empty`).toBe(400);
      if (opts.min && opts.min > 1)
        expect((await opts.attempt(make(opts.min - 1))).status, `${opts.what} under minimum`).toBe(
          400,
        );
    };

    let n = 0;
    it('companies and brands: name 2 to 120 characters, slug 2 to 64', async () => {
      await limit({
        what: 'company name',
        max: 120,
        min: 2,
        attempt: (v) =>
          send('POST', '/api/companies', 'groupAdmin2', { name: v, slug: `limit-${++n}` }),
        stored: async (c) =>
          (await h.query(`select name from companies where id = $1`, [c.id]))[0].name,
      });
      await limit({
        what: 'company slug',
        max: 64,
        min: 2,
        attempt: (v) =>
          send('POST', '/api/companies', 'groupAdmin2', { name: 'Slug test', slug: v }),
        stored: async (c) =>
          (await h.query(`select slug from companies where id = $1`, [c.id]))[0].slug,
      });
      await limit({
        what: 'brand name',
        max: 120,
        min: 2,
        attempt: (v) =>
          send('POST', `/api/companies/${companyA}/brands`, 'admin', {
            name: v,
            slug: `brand-limit-${++n}`,
          }),
        stored: async (b) =>
          (await h.query(`select name from brands where id = $1`, [b.id]))[0].name,
      });
    });

    it('social accounts: display name 2 to 160, handle 1 to 100', async () => {
      const ownerId = h.userIds.get('owner')!;
      await limit({
        what: 'account display name',
        max: 160,
        min: 2,
        attempt: (v) =>
          send('POST', '/api/social-accounts', 'admin', {
            companyId: companyA,
            platform: 'x',
            displayName: v,
            handle: `@limit${++n}`,
            ownerUserId: ownerId,
          }),
        stored: async (a) =>
          (await h.query(`select display_name from social_accounts where id = $1`, [a.id]))[0]
            .display_name,
      });
      await limit({
        what: 'account handle',
        max: 100,
        attempt: (v) =>
          send('POST', '/api/social-accounts', 'admin', {
            companyId: companyA,
            platform: 'tiktok',
            displayName: `Handle test ${++n}`,
            handle: v,
            ownerUserId: ownerId,
          }),
        stored: async (a) =>
          (await h.query(`select handle from social_accounts where id = $1`, [a.id]))[0].handle,
      });
    });

    it('content: body 1 to 10000 characters, at least one target account', async () => {
      await limit({
        what: 'content body',
        max: 10_000,
        attempt: (v) =>
          send('POST', '/api/content-items', 'creator', {
            companyId: companyA,
            body: v,
            targetAccountIds: [accountA],
          }),
        stored: async (c) =>
          (await h.query(`select body from content_versions where content_item_id = $1`, [c.id]))[0]
            .body,
      });
      expect(
        (
          await send('POST', '/api/content-items', 'creator', {
            companyId: companyA,
            body: 'x',
            targetAccountIds: [],
          })
        ).status,
      ).toBe(400);
      expect(
        (await send('POST', '/api/content-items', 'creator', { companyId: companyA, body: 'x' }))
          .status,
      ).toBe(400);
    });

    it('incidents: title 2 to 200, description up to 5000', async () => {
      await limit({
        what: 'incident title',
        max: 200,
        min: 2,
        attempt: (v) => send('POST', '/api/incidents', 'exec', { companyId: companyA, title: v }),
        stored: async (i) =>
          (await h.query(`select title from incidents where id = $1`, [i.id]))[0].title,
      });
      const over = await send('POST', '/api/incidents', 'exec', {
        companyId: companyA,
        title: 'Description test',
        description: chars(5001),
      });
      expect(over.status).toBe(400);
      const ok = await send('POST', '/api/incidents', 'exec', {
        companyId: companyA,
        title: 'Description test',
        description: chars(5000),
      });
      expect(ok.status).toBe(201);
      expect(
        (await h.query(`select description from incidents where id = $1`, [(await json(ok)).id]))[0]
          .description,
      ).toHaveLength(5000);
    });

    it('publishing freeze reason: up to 500; approval comment: 1 to 2000', async () => {
      const reason = (v: string) =>
        send('POST', '/api/publishing-freezes', 'exec', { companyId: companyA, reason: v });
      expect((await reason(chars(501))).status).toBe(400);
      const frozen = await reason(chars(500));
      expect(frozen.status).toBe(201);
      const row = await json(frozen);
      expect(
        (await h.query(`select reason from publishing_freezes where id = $1`, [row.id]))[0].reason,
      ).toHaveLength(500);
      expect((await send('DELETE', `/api/publishing-freezes/${row.id}`, 'exec')).status).toBe(204);

      const item = await json(
        await send('POST', '/api/content-items', 'creator', {
          companyId: companyA,
          body: 'Review limits.',
          targetAccountIds: [accountA],
        }),
      );
      const request = await json(
        await send('POST', `/api/content-items/${item.id}/submit`, 'creator'),
      );
      const review = (v: string) =>
        send('POST', `/api/approval-requests/${request.id}/review`, 'manager', { comment: v });
      expect((await review(chars(2001))).status).toBe(400);
      expect((await review('')).status).toBe(400);
      expect((await review(chars(2000))).status).toBeLessThan(300);
      expect(
        (
          await h.query(
            `select comment from approval_decisions where approval_request_id = $1 order by decided_at desc limit 1`,
            [request.id],
          )
        )[0].comment,
      ).toHaveLength(2000);
    });

    it('inbox reply: 1 to 2000 characters', async () => {
      const message: InboxMessage = {
        engineMessageId: 'limit-msg',
        engineChannelId: 'plan-channel-a',
        kind: 'comment',
        authorName: 'A customer',
        text: 'Question',
        receivedAt: new Date(Date.now() - 60_000),
        engineOperationId: null,
        replied: false,
      };
      h.fake.inboxMessages.push(message);
      const reply = (v: string) =>
        send('POST', '/api/inbox/reply', 'manager', {
          socialAccountId: accountA,
          engineMessageId: 'limit-msg',
          text: v,
        });
      expect((await reply(chars(2001))).status).toBe(400);
      expect((await reply('')).status).toBe(400);
      expect((await reply(chars(2000))).status).toBe(201);
      expect(h.fake.replies.at(-1)?.text).toHaveLength(2000);
    });
  });

  describe('B13: every status the database allows is a status the contracts name, and the other way round', () => {
    /** The values written in a `check (col in (...))` constraint of the live database. */
    const allowed = async (table: string, column: string): Promise<string[]> => {
      const rows = await h.query(
        `select pg_get_constraintdef(c.oid) as def
           from pg_constraint c join pg_class t on t.oid = c.conrelid
          where t.relname = $1 and c.contype = 'c'`,
        [table],
      );
      const def = rows
        .map((r) => r.def as string)
        .find((d) => d.includes(column) && d.includes("'"));
      expect(def, `${table}.${column} has a check constraint`).toBeTruthy();
      return [...def!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
    };
    const same = async (table: string, column: string, contract: readonly string[]) =>
      expect(await allowed(table, column), `${table}.${column}`).toEqual([...contract].sort());

    it('content, approvals, publications, accounts, companies, incidents, categories', async () => {
      await same('content_items', 'status', CONTENT_ITEM_STATUSES);
      await same('approval_requests', 'status', APPROVAL_REQUEST_STATUSES);
      await same('publications', 'status', PUBLICATION_STATUSES);
      await same('social_accounts', 'status', SOCIAL_ACCOUNT_STATUSES);
      await same('companies', 'status', COMPANY_STATUSES);
      await same('incidents', 'status', INCIDENT_STATUSES);
      await same('incidents', 'severity', INCIDENT_SEVERITIES);
      await same('incident_categories', 'status', INCIDENT_CATEGORY_STATUSES);
      await same('incident_recovery_contacts', 'status', INCIDENT_CONTACT_STATUSES);
      await same('incident_recovery_contacts', 'channel', INCIDENT_CONTACT_CHANNELS);
      await same('content_categories', 'status', CONTENT_CATEGORY_STATUSES);
      await same('social_accounts', 'platform', SOCIAL_PLATFORMS);
      await same('notifications', 'event_type', NOTIFICATION_EVENT_TYPES);
      await same('memberships', 'role', ROLES);
    });

    it('the API returns each status the database can hold, and only those', async () => {
      await h.persona('admin13', inA('company_admin'));
      // Every account status can be set through the API and comes back as the database holds it.
      for (const status of SOCIAL_ACCOUNT_STATUSES) {
        const response = await send('PATCH', `/api/social-accounts/${accountA}/status`, 'admin13', {
          status,
        });
        expect(response.status, status).toBe(200);
        expect(
          (await h.query(`select status from social_accounts where id = $1`, [accountA]))[0].status,
        ).toBe(status);
        const listed = (await json(await send('GET', '/api/social-accounts', 'admin13'))).find(
          (a: any) => a.id === accountA,
        );
        expect(listed.status).toBe(status);
      }
      // A status the database cannot hold is refused before it gets there.
      expect(
        (
          await send('PATCH', `/api/social-accounts/${accountA}/status`, 'admin13', {
            status: 'deleted',
          })
        ).status,
      ).toBe(400);
      expect(
        (await send('PATCH', `/api/companies/${companyA}`, 'admin13', { status: 'deleted' }))
          .status,
      ).toBe(403);
      expect(
        (await send('PATCH', `/api/incidents/${h.f.accountA}`, 'admin13', { status: 'deleted' }))
          .status,
      ).not.toBe(200);
    });
  });

  describe('B14: the API refuses an action the role cannot do (the screen only hides the button)', () => {
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
    const routes = (): Route[] => {
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
            const path = String(reflect.getMetadata(PATH_METADATA, handler) ?? '');
            found.push({
              method: METHODS[method] ?? String(method),
              path: `/api/${[prefix, path].join('/')}`.replace(/\/+/g, '/').replace(/\/$/, ''),
              permission:
                reflect.getMetadata(REQUIRED_PERMISSION, handler) ??
                reflect.getMetadata(REQUIRED_PERMISSION, controller),
              isPublic: Boolean(
                reflect.getMetadata(IS_PUBLIC, handler) ??
                reflect.getMetadata(IS_PUBLIC, controller),
              ),
            });
          }
        }
      return found;
    };
    const concrete = (path: string) =>
      path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');

    it('every route either needs a named permission, is public on purpose, or is one of the few open to any signed-in person', () => {
      const open = routes()
        .filter((r) => !r.permission && !r.isPublic)
        .map((r) => `${r.method} ${r.path}`)
        .sort();
      // Adding a route without @RequirePermission fails here until someone decides it is meant to be open.
      expect(open).toEqual(
        [
          'GET /api/me',
          'PUT /api/me/acting-role',
          'GET /api/notifications',
          'GET /api/notifications/unread-count',
          'POST /api/notifications/read-all',
          'POST /api/notifications/:id/read',
          'GET /api/dashboard',
          'POST /api/auth/logout',
        ].sort(),
      );
      const publicRoutes = routes()
        .filter((r) => r.isPublic)
        .map((r) => `${r.method} ${r.path}`)
        .sort();
      expect(publicRoutes).toEqual(
        [
          'GET /api/auth/login',
          'GET /api/auth/callback',
          'POST /api/auth/backchannel-logout',
          'GET /api/health/live',
          'GET /api/health/ready',
          'GET /api/metrics',
        ].sort(),
      );
    });

    it('each of the eleven roles gets 403 on exactly the routes whose permission it lacks', async () => {
      const personas: Array<{ role: (typeof ROLES)[number]; name: string }> = [];
      for (const role of ROLES) {
        const company = roleAllowedAtScope(role, 'company');
        await h.persona(`role-${role}`, [{ role, companyId: company ? companyA : null, groupId }]);
        personas.push({ role, name: `role-${role}` });
      }
      const guarded = routes().filter((r) => r.permission);
      expect(guarded.length).toBeGreaterThan(40);
      const wrong: string[] = [];
      for (const { role, name } of personas)
        for (const route of guarded) {
          const response = await send(
            route.method,
            concrete(route.path),
            name,
            route.method === 'GET' ? undefined : {},
          );
          const refusedByGate =
            response.status === 403 &&
            (await response.json()).message === 'You do not have permission to do that.';
          const mayDo = ROLE_PERMISSIONS[role].includes(route.permission!);
          if (refusedByGate === mayDo)
            wrong.push(
              `${role} ${route.method} ${route.path} (${route.permission}): got ${response.status}`,
            );
        }
      expect(wrong).toEqual([]);
    }, 180_000);
  });

  describe('B15: a refusal carries a message a person can read and a request id they can quote', () => {
    it('401, 400, 403, 404 and 409 all use one error shape, and the id matches the response header', async () => {
      await h.persona('b15creator', inA('content_creator'));
      await h.persona('b15group', [{ role: 'group_admin', companyId: null, groupId }]);
      await send('POST', '/api/companies', 'b15group', { name: 'Dup One', slug: 'dup-slug' });
      const duplicate = () =>
        send('POST', '/api/companies', 'b15group', { name: 'Dup Two', slug: 'dup-slug' });
      const cases: Array<[number, Response]> = [
        [401, await fetch(`${h.base}/api/me`, { headers: { origin: 'http://localhost:7717' } })],
        [
          400,
          await send('POST', '/api/content-items', 'b15creator', {
            companyId: companyA,
            body: '',
            targetAccountIds: [],
          }),
        ],
        [403, await send('POST', '/api/companies', 'b15creator', { name: 'Nope', slug: 'nope' })],
        [
          404,
          await send(
            'GET',
            '/api/content-items/00000000-0000-4000-8000-000000000000',
            'b15creator',
          ),
        ],
        [409, await duplicate()],
      ];
      for (const [status, response] of cases) {
        expect(response.status, await response.clone().text()).toBe(status);
        const body = await json(response);
        expect(body, String(status)).toMatchObject({
          statusCode: status,
          error: expect.any(String),
          message: expect.stringMatching(/\S/),
          requestId: expect.stringMatching(/^[A-Za-z0-9._-]{8,64}$/),
        });
        expect(response.headers.get('x-request-id')).toBe(body.requestId);
        // Never a stack trace or a database message.
        expect(JSON.stringify(body)).not.toMatch(/at .*\(|violates|constraint|select |pg_/i);
      }
      const custom = await send(
        'GET',
        '/api/content-items/00000000-0000-4000-8000-000000000000',
        'b15creator',
        undefined,
        {
          'x-request-id': 'plan-test-request-15',
        },
      );
      expect((await json(custom)).requestId).toBe('plan-test-request-15');
      const invalid = await json(
        await send('POST', '/api/content-items', 'b15creator', {
          companyId: 'nope',
          body: '',
          targetAccountIds: [],
        }),
      );
      expect(invalid.issues).toBeTruthy();
    });
  });

  describe('B16: after an action, reading it back shows what the database holds', () => {
    it('company, brand, account, content, incident and freeze', async () => {
      await h.persona('b16admin', inA('company_admin'));
      await h.persona('b16creator', inA('content_creator'));
      await h.persona('b16exec', inA('company_executive'));
      await h.persona('b16group', [{ role: 'group_admin', companyId: null, groupId }]);

      // Company: rename and suspend.
      const created = await json(
        await send('POST', '/api/companies', 'b16group', { name: 'Parity Co', slug: 'parity-co' }),
      );
      expect(
        (
          await send('PATCH', `/api/companies/${created.id}`, 'b16group', {
            name: 'Parity Company',
            status: 'suspended',
          })
        ).status,
      ).toBe(200);
      const listed = (await json(await send('GET', '/api/companies', 'b16group'))).find(
        (c: any) => c.id === created.id,
      );
      const companyRow = (
        await h.query(`select name, slug, status from companies where id = $1`, [created.id])
      )[0];
      expect(listed).toMatchObject(companyRow);

      // Brand and account.
      const brand = await json(
        await send('POST', `/api/companies/${companyA}/brands`, 'b16admin', {
          name: 'Parity Brand',
          slug: 'parity-brand',
        }),
      );
      const brands = await json(await send('GET', `/api/companies/${companyA}/brands`, 'b16admin'));
      expect(brands.find((b: any) => b.id === brand.id)).toMatchObject(
        (await h.query(`select name, slug from brands where id = $1`, [brand.id]))[0],
      );
      const account = await json(
        await send('POST', '/api/social-accounts', 'b16admin', {
          companyId: companyA,
          platform: 'linkedin',
          displayName: 'Parity page',
          handle: '@parity',
          ownerUserId: h.userIds.get('b16creator'),
          brandId: brand.id,
        }),
      );
      await send('PATCH', `/api/social-accounts/${account.id}`, 'b16admin', {
        displayName: 'Parity page renamed',
      });
      const accountRow = (
        await h.query(
          `select display_name, handle, platform, status, brand_id from social_accounts where id = $1`,
          [account.id],
        )
      )[0];
      expect(
        (await json(await send('GET', '/api/social-accounts', 'b16admin'))).find(
          (a: any) => a.id === account.id,
        ),
      ).toMatchObject({
        displayName: accountRow.display_name,
        handle: accountRow.handle,
        platform: accountRow.platform,
        status: accountRow.status,
        brandId: accountRow.brand_id,
      });

      // Content: create, edit (a new version), and its status after submit.
      const item = await json(
        await send('POST', '/api/content-items', 'b16creator', {
          companyId: companyA,
          body: 'First text.',
          targetAccountIds: [accountA],
        }),
      );
      await send('PATCH', `/api/content-items/${item.id}`, 'b16creator', { body: 'Second text.' });
      await send('POST', `/api/content-items/${item.id}/submit`, 'b16creator');
      const read = await json(await send('GET', `/api/content-items/${item.id}`, 'b16creator'));
      const itemRow = (
        await h.query(`select status from content_items where id = $1`, [item.id])
      )[0];
      const versions = await h.query(
        `select version_number, body from content_versions where content_item_id = $1 order by version_number`,
        [item.id],
      );
      expect(read.status).toBe(itemRow.status);
      expect(read.status).toBe('in_review');
      const listedVersions = await json(
        await send('GET', `/api/content-items/${item.id}/versions`, 'b16creator'),
      );
      expect(
        listedVersions
          .map((v: any) => [v.versionNumber, v.body])
          .sort((x: any, y: any) => x[0] - y[0]),
      ).toEqual(versions.map((v) => [v.version_number, v.body]));

      // Incident and freeze.
      const incident = await json(
        await send('POST', '/api/incidents', 'b16exec', {
          companyId: companyA,
          title: 'Parity incident',
          severity: 'high',
        }),
      );
      await send('PATCH', `/api/incidents/${incident.id}`, 'b16exec', {
        status: 'investigating',
        description: 'Looking.',
      });
      expect(
        await json(await send('GET', `/api/incidents/${incident.id}`, 'b16exec')),
      ).toMatchObject(
        (({ title, severity, status, description }) => ({ title, severity, status, description }))(
          (
            await h.query(
              `select title, severity, status, description from incidents where id = $1`,
              [incident.id],
            )
          )[0],
        ),
      );
      const freeze = await json(
        await send('POST', '/api/publishing-freezes', 'b16exec', {
          companyId: companyA,
          reason: 'Parity',
        }),
      );
      const frozen = (await json(await send('GET', '/api/publishing-freezes', 'b16exec'))).find(
        (x: any) => x.id === freeze.id,
      );
      expect(frozen).toMatchObject({ companyId: companyA, reason: 'Parity' });
      await send('DELETE', `/api/publishing-freezes/${freeze.id}`, 'b16exec');
      expect(
        (await json(await send('GET', '/api/publishing-freezes', 'b16exec'))).some(
          (x: any) => x.id === freeze.id,
        ),
      ).toBe(false);
      expect(
        await h.query(`select 1 from publishing_freezes where id = $1`, [freeze.id]),
      ).toHaveLength(0);
    });
  });
});

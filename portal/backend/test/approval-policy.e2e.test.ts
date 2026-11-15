import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

/**
 * H-09: who must approve what is data, set on a screen, not code.
 *
 * People in company A for this file:
 *   - adminA:     company_admin + content_creator       sets the policy; writes content
 *   - auditorA:   auditor + company_marketing_manager   may approve
 *   - outsider:   company_executive                     may approve
 *   - groupAdmin: group_admin (group level)             maintains the categories
 */
describe('approval policy as data (H-09)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const grant = (userId: string, role: string) =>
      owner.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`,
        [userId, f.groupId, f.companyA, role],
      );
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-1' where id = $1`,
      [f.accountA],
    );
    await grant(f.users.adminA, 'content_creator');
    await grant(f.users.auditorA, 'company_marketing_manager');
    await grant(f.users.outsider, 'company_executive');
    await owner.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    base = await listenForTests(app);
    const sessions = app.get(SessionService);
    for (const [name, id] of Object.entries(f.users)) {
      cookies.set(name, `dcc_sid=${(await sessions.create({ userId: id })).id}`);
    }
  });
  afterAll(async () => {
    await app.close();
  });

  const send = (method: string, path: string, who: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      redirect: 'manual',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        cookie: cookies.get(who)!,
        origin: ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    });
  const json = async (r: Response) => r.json() as Promise<any>;
  const submitted = async (categoryId?: string) => {
    const item = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'A post under a policy.',
        targetAccountIds: [f.accountA],
        ...(categoryId ? { categoryId } : {}),
      }),
    );
    const request = await json(
      await send('POST', `/api/content-items/${item.id}/submit`, 'adminA'),
    );
    return { item, request };
  };
  const decide = (who: string, requestId: string, action: 'approve' | 'reject') =>
    send('POST', `/api/approval-requests/${requestId}/${action}`, who, {});
  const setPolicy = (who: string, body: Record<string, unknown>) =>
    send('PUT', '/api/approval-policies', who, body);

  let crisis: string;
  let campaign: string;

  describe('categories: the Group’s own list', () => {
    it('a group-level administrator creates them; a company administrator cannot; everyone working there can read them', async () => {
      const created = await send('POST', '/api/content-categories', 'groupAdmin', {
        key: 'crisis',
        name: 'Crisis communication',
      });
      expect(created.status).toBe(201);
      crisis = (await json(created)).id;
      campaign = (
        await json(
          await send('POST', '/api/content-categories', 'groupAdmin', {
            key: 'campaign',
            name: 'Campaign',
          }),
        )
      ).id;

      expect(
        (await send('POST', '/api/content-categories', 'adminA', { key: 'x1', name: 'Mine' }))
          .status,
      ).toBe(403);
      expect(
        (
          await send('POST', '/api/content-categories', 'groupAdmin', {
            key: 'crisis',
            name: 'Again',
          })
        ).status,
      ).toBe(409);

      const seenByCreator = await json(await send('GET', '/api/content-categories', 'creatorB'));
      expect(seenByCreator.map((c: { key: string }) => c.key).sort()).toEqual([
        'campaign',
        'crisis',
      ]);
      // another group sees none of them
      expect(await json(await send('GET', '/api/content-categories', 'otherGroupAdmin'))).toEqual(
        [],
      );
    });

    it('an archived or unknown category is refused for new content', async () => {
      const old = await json(
        await send('POST', '/api/content-categories', 'groupAdmin', {
          key: 'old-kind',
          name: 'Old kind',
        }),
      );
      expect(
        (
          await send('PATCH', `/api/content-categories/${old.id}`, 'groupAdmin', {
            status: 'archived',
          })
        ).status,
      ).toBe(200);
      const body = { companyId: f.companyA, body: 'x', targetAccountIds: [f.accountA] };
      const archived = await send('POST', '/api/content-items', 'adminA', {
        ...body,
        categoryId: old.id,
      });
      expect(archived.status).toBe(400);
      expect((await json(archived)).message).toMatch(/archived/);
      const unknown = await send('POST', '/api/content-items', 'adminA', {
        ...body,
        categoryId: '11111111-1111-4111-8111-111111111111',
      });
      expect(unknown.status).toBe(400);
    });
  });

  describe('with no policy the rule is what it always was', () => {
    it('one approver settles it, and the request says 1 of 1', async () => {
      const { request } = await submitted();
      expect(request).toMatchObject({ requiredApprovals: 1, approvals: 0, approverRoles: [] });
      const res = await json(await decide('auditorA', request.id, 'approve'));
      expect(res).toMatchObject({ status: 'approved', approvals: 1, requiredApprovals: 1 });
    });
  });

  describe('two different people must approve', () => {
    it('the first approval leaves it waiting and unpublishable; the same person cannot approve twice; the second settles it', async () => {
      const set = await setPolicy('adminA', {
        companyId: f.companyA,
        categoryId: crisis,
        requiredApprovals: 2,
        approverRoles: [],
      });
      expect(set.status).toBe(200);

      const { item, request } = await submitted(crisis);
      expect(request.requiredApprovals).toBe(2);

      const first = await json(await decide('auditorA', request.id, 'approve'));
      expect(first).toMatchObject({ status: 'pending', approvals: 1, requiredApprovals: 2 });
      expect(
        (await json(await send('GET', `/api/content-items/${item.id}`, 'adminA'))).status,
      ).toBe('in_review');
      expect(
        (
          await send('POST', `/api/content-items/${item.id}/publish`, 'outsider', {
            socialAccountId: f.accountA,
          })
        ).status,
      ).toBe(403);

      expect((await decide('auditorA', request.id, 'approve')).status).toBe(409);

      const queue = await json(
        await send('GET', '/api/approval-requests?status=pending', 'outsider'),
      );
      expect(queue.find((q: { id: string }) => q.id === request.id)).toMatchObject({
        approvals: 1,
        requiredApprovals: 2,
      });

      const second = await json(await decide('outsider', request.id, 'approve'));
      expect(second).toMatchObject({ status: 'approved', approvals: 2 });
      expect(
        (
          await send('POST', `/api/content-items/${item.id}/publish`, 'outsider', {
            socialAccountId: f.accountA,
          })
        ).status,
      ).toBe(201);
    });

    it('one rejection ends it at once, whatever the count', async () => {
      const { request } = await submitted(crisis);
      await decide('auditorA', request.id, 'approve');
      const rejected = await json(await decide('outsider', request.id, 'reject'));
      expect(rejected.status).toBe('rejected');
    });
  });

  describe('only some roles may decide', () => {
    it('a role the policy does not name is refused with the roles that may; a named role decides', async () => {
      await setPolicy('adminA', {
        companyId: f.companyA,
        categoryId: campaign,
        requiredApprovals: 1,
        approverRoles: ['company_executive'],
      });
      const { request } = await submitted(campaign);
      expect(request.approverRoles).toEqual(['company_executive']);

      const refused = await decide('auditorA', request.id, 'approve');
      expect(refused.status).toBe(403);
      expect((await json(refused)).message).toMatch(/decided by: Company CEO \/ executive/);
      expect((await decide('auditorA', request.id, 'reject')).status).toBe(403);
      // commenting stays open to reviewers
      expect(
        (
          await send('POST', `/api/approval-requests/${request.id}/review`, 'auditorA', {
            comment: 'Looks right to me.',
          })
        ).status,
      ).toBe(201);

      expect((await json(await decide('outsider', request.id, 'approve'))).status).toBe('approved');
    });
  });

  describe('the rule of a waiting request does not change under it', () => {
    it('a request opened under "one approver" is still settled by one after the policy is raised', async () => {
      const { request } = await submitted(); // no category, no default policy yet: 1 approver
      await setPolicy('adminA', { companyId: f.companyA, requiredApprovals: 3, approverRoles: [] });
      const res = await json(await decide('auditorA', request.id, 'approve'));
      expect(res).toMatchObject({ status: 'approved', requiredApprovals: 1 });

      // and new content without a category now follows the company default
      const next = await submitted();
      expect(next.request.requiredApprovals).toBe(3);
    });
  });

  describe('who may set a policy, and what is refused', () => {
    it('lists, replaces and removes; audited', async () => {
      const list = await json(
        await send('GET', `/api/approval-policies?companyId=${f.companyA}`, 'adminA'),
      );
      expect(list).toHaveLength(3);
      const fallback = list.find((p: { categoryId: string | null }) => p.categoryId === null);

      const replaced = await json(
        await setPolicy('adminA', { companyId: f.companyA, requiredApprovals: 2 }),
      );
      expect(replaced.id).toBe(fallback.id);
      expect(replaced.requiredApprovals).toBe(2);

      expect((await send('DELETE', `/api/approval-policies/${fallback.id}`, 'adminA')).status).toBe(
        204,
      );
      expect((await submitted()).request.requiredApprovals).toBe(1);

      const owner = new pg.Client({ connectionString: ownerUrl() });
      await owner.connect();
      const events = await owner.query(
        `select action from audit_events where action like 'approval_policy.%' and target_id = $1 order by id`,
        [fallback.id],
      );
      await owner.end();
      expect(events.rows.map((e) => e.action)).toEqual([
        'approval_policy.set',
        'approval_policy.set',
        'approval_policy.removed',
      ]);
    });

    it('refuses a role that cannot approve, a count out of range, another company and a person without the permission', async () => {
      const cannotApprove = await setPolicy('adminA', {
        companyId: f.companyA,
        requiredApprovals: 1,
        approverRoles: ['content_creator'],
      });
      expect(cannotApprove.status).toBe(400);
      expect((await json(cannotApprove)).message).toMatch(
        /cannot approve content: content_creator/,
      );

      for (const n of [0, 6, 1.5]) {
        expect(
          (await setPolicy('adminA', { companyId: f.companyA, requiredApprovals: n })).status,
        ).toBe(400);
      }
      expect(
        (await setPolicy('adminA', { companyId: f.companyB, requiredApprovals: 2 })).status,
      ).toBe(404);
      expect(
        (await setPolicy('auditorA', { companyId: f.companyA, requiredApprovals: 2 })).status,
      ).toBe(403);
      expect(
        (await setPolicy('otherGroupAdmin', { companyId: f.companyA, requiredApprovals: 2 }))
          .status,
      ).toBe(404);
    });

    it('a policy of company A is invisible to company B', async () => {
      expect(await json(await send('GET', '/api/approval-policies', 'creatorB'))).toEqual([]);
    });
  });
});

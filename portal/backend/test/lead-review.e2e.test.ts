import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EngineOutcomeUnknownError, type FakeEngine } from '@dcc/engine-client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OPERATIONAL_ENGINE } from '../src/modules/publishing/operational-engine.provider';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

/**
 * Findings of the architect's review of the content, publishing and notification modules
 * (docs/project/reviews/2026-11-13-BACKEND-MODULES-REVIEW.md). Each test failed before its fix.
 *
 * People in company A for this file:
 *   - adminA:     company_admin + content_creator         (writes content)
 *   - auditorA:   auditor + company_marketing_manager     (may write, submit, approve and publish)
 *   - outsider:   company_executive                       (may approve and publish, never writes)
 *   - groupAdmin: group_admin + group_marketing, both at GROUP level (reviews for every company)
 */
describe('architect review findings (content, publishing, notifications)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let engine: FakeEngine;
  const cookies = new Map<string, string>();

  const asOwner = async <T>(work: (c: pg.Client) => Promise<T>): Promise<T> => {
    const c = new pg.Client({ connectionString: ownerUrl() });
    await c.connect();
    try {
      return await work(c);
    } finally {
      await c.end();
    }
  };

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    await asOwner(async (c) => {
      const grant = (userId: string, companyId: string | null, role: string) =>
        c.query(
          `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`,
          [userId, f.groupId, companyId, role],
        );
      await c.query(
        `update social_accounts set engine_channel_id = 'engine-channel-a' where id = $1`,
        [f.accountA],
      );
      await grant(f.users.adminA, f.companyA, 'content_creator');
      await grant(f.users.auditorA, f.companyA, 'company_marketing_manager');
      await grant(f.users.outsider, f.companyA, 'company_executive');
      await grant(f.users.groupAdmin, null, 'group_marketing');
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    base = await listenForTests(app);
    engine = app.get(OPERATIONAL_ENGINE);
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

  const draft = async (who: string, body: string) =>
    json(
      await send('POST', '/api/content-items', who, {
        companyId: f.companyA,
        body,
        targetAccountIds: [f.accountA],
      }),
    );
  const submit = async (who: string, itemId: string) =>
    json(await send('POST', `/api/content-items/${itemId}/submit`, who));

  describe('separation of duties covers everyone who wrote a version, not only the first author', () => {
    it('a person who rewrote the text cannot approve their own version', async () => {
      const item = await draft('adminA', 'First draft by the creator.');
      const edited = await send('PATCH', `/api/content-items/${item.id}`, 'auditorA', {
        body: 'Rewritten by the manager.',
      });
      expect(edited.status).toBe(200);
      const request = await submit('auditorA', item.id);

      const own = await send(
        'POST',
        `/api/approval-requests/${request.id}/approve`,
        'auditorA',
        {},
      );
      expect(own.status).toBe(403);

      const other = await send(
        'POST',
        `/api/approval-requests/${request.id}/approve`,
        'outsider',
        {},
      );
      expect(other.status).toBe(201);
      expect((await json(other)).status).toBe('approved');
    });

    it('a person who wrote an earlier version cannot approve a later one, nor reject or review it', async () => {
      const item = await draft('adminA', 'Version one.');
      await send('PATCH', `/api/content-items/${item.id}`, 'auditorA', { body: 'Version two.' });
      await send('PATCH', `/api/content-items/${item.id}`, 'adminA', { body: 'Version three.' });
      const request = await submit('adminA', item.id);

      for (const action of ['approve', 'reject'] as const) {
        const res = await send(
          'POST',
          `/api/approval-requests/${request.id}/${action}`,
          'auditorA',
          {},
        );
        expect(res.status, action).toBe(403);
      }
      const review = await send('POST', `/api/approval-requests/${request.id}/review`, 'auditorA', {
        comment: 'Looks fine to me.',
      });
      expect(review.status).toBe(403);
    });

    it('someone who never wrote any version may still approve', async () => {
      const item = await draft('adminA', 'Clean case.');
      const request = await submit('adminA', item.id);
      const res = await send(
        'POST',
        `/api/approval-requests/${request.id}/approve`,
        'auditorA',
        {},
      );
      expect(res.status).toBe(201);
    });
  });

  describe('notifications reach reviewers who hold the permission at group level', () => {
    it('a group-level reviewer is told when a company-level creator submits', async () => {
      const item = await draft('adminA', 'Needs a group reviewer.');
      await submit('adminA', item.id);

      const inbox = await json(await send('GET', '/api/notifications', 'groupAdmin'));
      expect(
        inbox.some(
          (n: { eventType: string; targetId: string }) =>
            n.eventType === 'content.submitted' && n.targetId === item.id,
        ),
      ).toBe(true);
    });

    it('nobody outside the company and its group is told', async () => {
      const item = await draft('adminA', 'Stays inside the group.');
      await submit('adminA', item.id);
      const rows = await asOwner((c) =>
        c.query(`select recipient_user_id from notifications where target_id = $1`, [item.id]),
      );
      const recipients = rows.rows.map((r) => r.recipient_user_id as string);
      expect(recipients).not.toContain(f.users.otherGroupAdmin);
      expect(recipients).not.toContain(f.users.creatorB);
      expect(recipients).not.toContain(f.users.adminA);
    });
  });

  describe('publishing', () => {
    const approved = async (body: string) => {
      const item = await draft('adminA', body);
      const request = await submit('adminA', item.id);
      await send('POST', `/api/approval-requests/${request.id}/approve`, 'outsider', {});
      return item;
    };

    it('a published item says so in its own status', async () => {
      const item = await approved('Status follows the publication.');
      const res = await send('POST', `/api/content-items/${item.id}/publish`, 'outsider', {
        socialAccountId: f.accountA,
      });
      expect(res.status).toBe(201);
      const after = await json(await send('GET', `/api/content-items/${item.id}`, 'outsider'));
      expect(after.status).toBe('published');
    });

    it('an outcome the engine could not confirm is on the audit record', async () => {
      const item = await approved('Timeout case.');
      engine.failNextWith = new EngineOutcomeUnknownError('engine timed out');
      const res = await send('POST', `/api/content-items/${item.id}/publish`, 'outsider', {
        socialAccountId: f.accountA,
      });
      const publication = await json(res);
      expect(publication.status).toBe('pending');

      const events = await asOwner((c) =>
        c.query(`select action, details from audit_events where target_id = $1`, [publication.id]),
      );
      expect(events.rows.map((e) => e.action)).toContain('publication.outcome_unknown');

      // And it stays blocked: a blind retry never reaches the engine.
      const before = engine.published.length;
      const retry = await send('POST', `/api/content-items/${item.id}/publish`, 'outsider', {
        socialAccountId: f.accountA,
      });
      expect(retry.status).toBe(409);
      expect(engine.published).toHaveLength(before);
    });

    it('nothing is published to an account that is archived or disconnected', async () => {
      for (const status of ['archived', 'disconnected']) {
        const item = await approved(`Account is ${status}.`);
        await asOwner((c) =>
          c.query(`update social_accounts set status = $2 where id = $1`, [f.accountA, status]),
        );
        const before = engine.published.length;
        const res = await send('POST', `/api/content-items/${item.id}/publish`, 'outsider', {
          socialAccountId: f.accountA,
        });
        await asOwner((c) =>
          c.query(`update social_accounts set status = 'active' where id = $1`, [f.accountA]),
        );
        expect(res.status, status).toBe(403);
        expect(engine.published, status).toHaveLength(before);
      }
    });
  });
});

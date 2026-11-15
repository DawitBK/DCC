import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FakeEngine } from '@dcc/engine-client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OPERATIONAL_ENGINE } from '../src/modules/publishing/operational-engine.provider';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

/** Cancelling a scheduled publication, and recording what the engine did with scheduled ones. */
describe('cancel and reconcile', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let fake: FakeEngine;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const grant = (userId: string, companyId: string, role: string) =>
      owner.query(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`,
        [userId, f.groupId, companyId, role],
      );
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-1' where id = $1`,
      [f.accountA],
    );
    await grant(f.users.adminA, f.companyA, 'content_creator');
    await grant(f.users.auditorA, f.companyA, 'company_marketing_manager');
    await grant(f.users.outsider, f.companyA, 'company_executive');
    await grant(f.users.creatorB, f.companyB, 'publisher');
    await owner.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    base = await listenForTests(app);
    fake = app.get(OPERATIONAL_ENGINE);
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
  const scheduled = async (text: string) => {
    const item = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: text,
        targetAccountIds: [f.accountA],
      }),
    );
    const request = await json(
      await send('POST', `/api/content-items/${item.id}/submit`, 'adminA'),
    );
    await send('POST', `/api/approval-requests/${request.id}/approve`, 'auditorA', {});
    const publish = () =>
      send('POST', `/api/content-items/${item.id}/publish`, 'outsider', {
        socialAccountId: f.accountA,
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      });
    return { item, publish, publication: await json(await publish()) };
  };

  it('a scheduled publication is cancelled, leaves the engine, and the same version can be scheduled again', async () => {
    const { publication, publish } = await scheduled('To be cancelled.');
    expect(publication.status).toBe('scheduled');
    expect(fake.posts.has(publication.engineOperationId)).toBe(true);

    // another company's publisher cannot see it
    expect(
      (await send('POST', `/api/publications/${publication.id}/cancel`, 'creatorB')).status,
    ).toBe(404);
    const cancelled = await send('POST', `/api/publications/${publication.id}/cancel`, 'outsider');
    expect(cancelled.status).toBe(200);
    expect((await json(cancelled)).status).toBe('cancelled');
    expect(fake.posts.has(publication.engineOperationId)).toBe(false);
    // twice is refused
    expect(
      (await send('POST', `/api/publications/${publication.id}/cancel`, 'outsider')).status,
    ).toBe(409);

    const again = await publish();
    expect(again.status).toBe(201);
    expect((await json(again)).status).toBe('scheduled');
  });

  it('reconcile records what the engine did: sent becomes published with its link, a failure becomes failed', async () => {
    const sent = await scheduled('Will go out.');
    const broken = await scheduled('Will fail at the network.');
    const post = (id: string) => fake.posts.get(id)!;
    Object.assign(post(sent.publication.engineOperationId), {
      state: 'published',
      releaseUrl: 'https://network.example/post/1',
    });
    Object.assign(post(broken.publication.engineOperationId), {
      state: 'error',
      error: 'The network refused the post.',
    });

    const result = await json(await send('POST', '/api/publications/reconcile', 'outsider'));
    expect(result).toMatchObject({ published: 1, failed: 1 });
    expect(result.stillWaiting).toBeGreaterThanOrEqual(1); // the re-scheduled one of the first test

    const all = await json(await send('GET', '/api/publications', 'outsider'));
    const byId = (id: string) => all.find((p: { id: string }) => p.id === id);
    expect(byId(sent.publication.id)).toMatchObject({
      status: 'published',
      externalPostUrl: 'https://network.example/post/1',
    });
    expect(byId(broken.publication.id)).toMatchObject({
      status: 'failed',
      error: 'The network refused the post.',
    });
    expect(
      (await json(await send('GET', `/api/content-items/${sent.item.id}`, 'adminA'))).status,
    ).toBe('published');
    // company B's publisher reconciles only company B: nothing to check
    expect(await json(await send('POST', '/api/publications/reconcile', 'creatorB'))).toMatchObject(
      {
        checked: 0,
      },
    );
  });
});

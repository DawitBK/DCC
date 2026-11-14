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

/**
 * H-05: publishing records, the idempotency store, and the freeze switch - against the fake engine
 * (the adapter is unverified against a live Postiz, W-03/ASM-08; ENGINE_PROVIDER=fake is what
 * test/setup-env.ts already sets). Grants, same pattern as the other content test files: adminA
 * (creator + freeze permission, already company_admin) and auditorA (approve + publish, via an extra
 * company_marketing_manager role), scoped to this file only.
 */
describe('publishing records, idempotency and the freeze switch (H-05)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let engine: FakeEngine;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    await owner.query(
      `update social_accounts set engine_channel_id = 'engine-channel-a' where id = $1`,
      [f.accountA],
    );
    await owner.query(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'content_creator')`,
      [f.users.adminA, f.groupId, f.companyA],
    );
    await owner.query(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'company_marketing_manager')`,
      [f.users.auditorA, f.groupId, f.companyA],
    );
    await owner.end();

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

  const call = (
    path: string,
    who?: string,
    init: RequestInit & { origin?: string | null } = {},
  ) => {
    const { origin = ORIGIN, headers, ...rest } = init;
    return fetch(`${base}${path}`, {
      redirect: 'manual',
      ...rest,
      headers: {
        ...(who ? { cookie: cookies.get(who)! } : {}),
        ...(origin ? { origin } : {}),
        ...(rest.body ? { 'content-type': 'application/json' } : {}),
        ...(headers as Record<string, string>),
      },
    });
  };
  const json = async (r: Response) => r.json() as Promise<any>;
  const send = (method: string, path: string, who: string, body?: unknown) =>
    call(path, who, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  const draftSubmitApprove = async (body: string) => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body,
        targetAccountIds: [f.accountA],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${created.id}/submit`, 'adminA'),
    );
    await send('POST', `/api/approval-requests/${submitted.id}/approve`, 'auditorA', {});
    return created;
  };

  it('an approved item publishes to one of its approved targets, and it is audited', async () => {
    const created = await draftSubmitApprove('Happy path post.');
    const before = engine.published.length;

    const res = await send('POST', `/api/content-items/${created.id}/publish`, 'auditorA', {
      socialAccountId: f.accountA,
    });
    expect(res.status).toBe(201);
    const publication = await json(res);
    expect(publication).toMatchObject({
      companyId: f.companyA,
      contentItemId: created.id,
      socialAccountId: f.accountA,
      status: 'published',
    });
    expect(publication.engineOperationId).toBeTruthy();
    expect(engine.published).toHaveLength(before + 1);

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const events = (
      await owner.query(`select action from audit_events where target_id = $1`, [publication.id])
    ).rows;
    await owner.end();
    expect(events.map((e) => e.action)).toContain('publication.published');
  });

  it('clicking publish again for the same version and target never calls the engine twice (sequential)', async () => {
    const created = await draftSubmitApprove('Double click, sequential.');
    const before = engine.published.length;

    const first = await json(
      await send('POST', `/api/content-items/${created.id}/publish`, 'auditorA', {
        socialAccountId: f.accountA,
      }),
    );
    const second = await json(
      await send('POST', `/api/content-items/${created.id}/publish`, 'auditorA', {
        socialAccountId: f.accountA,
      }),
    );
    expect(second.id).toBe(first.id);
    expect(second.engineOperationId).toBe(first.engineOperationId);
    expect(engine.published).toHaveLength(before + 1);
  });

  it('two concurrent publish attempts never both reach the engine (the race case)', async () => {
    const created = await draftSubmitApprove('Double click, concurrent.');
    const before = engine.published.length;

    const [a, b] = await Promise.all([
      send('POST', `/api/content-items/${created.id}/publish`, 'auditorA', {
        socialAccountId: f.accountA,
      }),
      send('POST', `/api/content-items/${created.id}/publish`, 'auditorA', {
        socialAccountId: f.accountA,
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    // Exactly one succeeds; the other is refused as already in progress (or, if it lands just after
    // completion, also succeeds with the cached result) - either way the engine is called once.
    expect(statuses.some((s) => s === 201)).toBe(true);
    expect(engine.published).toHaveLength(before + 1);
  });

  it('an item that is not approved cannot be published', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Never approved.',
        targetAccountIds: [f.accountA],
      }),
    );
    const before = engine.published.length;
    const res = await send('POST', `/api/content-items/${created.id}/publish`, 'auditorA', {
      socialAccountId: f.accountA,
    });
    expect(res.status).toBe(403);
    expect(engine.published).toHaveLength(before);
  });

  it('an account not connected to the engine cannot be published to', async () => {
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const unconnected = await owner.query(
      `insert into social_accounts (company_id, platform, display_name, handle) values ($1, 'facebook', 'Unconnected', '@unc') returning id`,
      [f.companyA],
    );
    await owner.end();

    const created = await draftSubmitApprove(
      'Targets a connected account, but publish asks for another.',
    );
    const res = await send('POST', `/api/content-items/${created.id}/publish`, 'auditorA', {
      socialAccountId: unconnected.rows[0].id,
    });
    expect(res.status).toBe(400);
  });

  it('a role without content.publish cannot publish, even an approved item', async () => {
    const created = await draftSubmitApprove('Creator should not be able to publish.');
    expect(
      (
        await send('POST', `/api/content-items/${created.id}/publish`, 'adminA', {
          socialAccountId: f.accountA,
        })
      ).status,
    ).toBe(403);
  });

  it('freezing the whole company refuses publishing; unfreezing allows it again', async () => {
    const created = await draftSubmitApprove('Frozen company.');
    const before = engine.published.length;

    const frozen = await json(
      await send('POST', '/api/publishing-freezes', 'adminA', {
        companyId: f.companyA,
        reason: 'Incident',
      }),
    );
    expect(frozen).toMatchObject({ companyId: f.companyA, socialAccountId: null });

    const refused = await send('POST', `/api/content-items/${created.id}/publish`, 'auditorA', {
      socialAccountId: f.accountA,
    });
    expect(refused.status).toBe(403);
    expect(engine.published).toHaveLength(before);

    expect(
      (await call(`/api/publishing-freezes/${frozen.id}`, 'adminA', { method: 'DELETE' })).status,
    ).toBe(204);
    const allowed = await send('POST', `/api/content-items/${created.id}/publish`, 'auditorA', {
      socialAccountId: f.accountA,
    });
    expect(allowed.status).toBe(201);
    expect(engine.published).toHaveLength(before + 1);
  });

  it('freezing is scoped: a different company is unaffected, duplicates are refused, and a role without publishing.freeze cannot freeze', async () => {
    expect(
      (await send('POST', '/api/publishing-freezes', 'auditorA', { companyId: f.companyA })).status,
    ).toBe(403);
    expect(
      (await send('POST', '/api/publishing-freezes', 'adminA', { companyId: f.companyB })).status,
    ).toBe(404);

    const first = await json(
      await send('POST', '/api/publishing-freezes', 'adminA', {
        companyId: f.companyA,
        socialAccountId: f.accountA,
      }),
    );
    expect(
      (
        await send('POST', '/api/publishing-freezes', 'adminA', {
          companyId: f.companyA,
          socialAccountId: f.accountA,
        })
      ).status,
    ).toBe(409);

    const list = await json(await call('/api/publishing-freezes', 'adminA'));
    expect(list.some((x: any) => x.id === first.id)).toBe(true);

    await call(`/api/publishing-freezes/${first.id}`, 'adminA', { method: 'DELETE' });
    expect(
      (await call(`/api/publishing-freezes/${first.id}`, 'adminA', { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it('publication history is scoped to the caller', async () => {
    const list = await json(await call('/api/publications', 'creatorB'));
    expect(list.every((p: any) => p.companyId === f.companyB)).toBe(true);
  });
});

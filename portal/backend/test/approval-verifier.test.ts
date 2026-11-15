import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ContentApprovalVerifier } from '../src/modules/content/approval-verifier';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

/**
 * H-04 part 3: the ApprovalVerifier GovernedEngine will call before it ever publishes anything. No
 * HTTP surface of its own - drives real content/approval endpoints to set up state, then calls
 * verify() directly (as GovernedEngine itself will, once H-05 wires it in).
 */
describe('ApprovalVerifier (H-04 part 3)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let verifier: ContentApprovalVerifier;
  const cookies = new Map<string, string>();

  const request = (overrides: Partial<Record<string, unknown>> = {}) => ({
    idempotencyKey: 'test-key',
    dccContentId: '',
    approvalVersion: 1,
    approverUserId: '',
    companyId: '',
    channelId: '',
    text: 'irrelevant for verify()',
    scheduledAt: null,
    ...overrides,
  });

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
      `insert into social_accounts (company_id, platform, display_name, handle, engine_channel_id)
       values ($1, 'x', 'Second A page', '@a2', 'engine-channel-a2')`,
      [f.companyA],
    );
    // adminA (creator) and auditorA (a different person, who may approve) - same extra grants as
    // content-approvals.e2e.test.ts, scoped to this file only.
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
    verifier = app.get(ContentApprovalVerifier);
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

  it('a draft with no approval does not verify', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Draft only.',
        targetAccountIds: [f.accountA],
      }),
    );
    const decision = await verifier.verify(
      request({ dccContentId: created.id, companyId: f.companyA, channelId: 'engine-channel-a' }),
    );
    expect(decision).toEqual({ ok: false, reason: 'This version is not approved.' });
  });

  it('an approved, still-current version for one of its approved targets verifies', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Approved post.',
        targetAccountIds: [f.accountA],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${created.id}/submit`, 'adminA'),
    );
    await send('POST', `/api/approval-requests/${submitted.id}/approve`, 'auditorA', {});

    const decision = await verifier.verify(
      request({ dccContentId: created.id, companyId: f.companyA, channelId: 'engine-channel-a' }),
    );
    expect(decision).toEqual({ ok: true });
  });

  it('a channel that is not one of the approved targets does not verify', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Targets only account A.',
        targetAccountIds: [f.accountA],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${created.id}/submit`, 'adminA'),
    );
    await send('POST', `/api/approval-requests/${submitted.id}/approve`, 'auditorA', {});

    const decision = await verifier.verify(
      request({ dccContentId: created.id, companyId: f.companyA, channelId: 'engine-channel-a2' }),
    );
    expect(decision).toEqual({
      ok: false,
      reason: "This channel is not one of the version's approved targets.",
    });
  });

  it('an unknown engine channel id does not verify (no crash)', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Approved, unknown channel.',
        targetAccountIds: [f.accountA],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${created.id}/submit`, 'adminA'),
    );
    await send('POST', `/api/approval-requests/${submitted.id}/approve`, 'auditorA', {});

    const decision = await verifier.verify(
      request({ dccContentId: created.id, companyId: f.companyA, channelId: 'no-such-channel' }),
    );
    expect(decision).toEqual({ ok: false, reason: 'Unknown channel.' });
  });

  it('a superseded version never verifies, even though its own approval is still "approved"', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Will be edited after approval.',
        targetAccountIds: [f.accountA],
      }),
    );
    const submitted = await json(
      await send('POST', `/api/content-items/${created.id}/submit`, 'adminA'),
    );
    await send('POST', `/api/approval-requests/${submitted.id}/approve`, 'auditorA', {});

    // Edit after approval: H-04 step 6, resets the item to draft and makes version 1 no longer current.
    await send('PATCH', `/api/content-items/${created.id}`, 'adminA', {
      body: 'Edited after approval.',
    });

    const decision = await verifier.verify(
      request({
        dccContentId: created.id,
        approvalVersion: 1,
        companyId: f.companyA,
        channelId: 'engine-channel-a',
      }),
    );
    expect(decision).toEqual({
      ok: false,
      reason: 'A newer version exists; this version is no longer current.',
    });
  });

  it('a content item from another company does not verify, even with the right id', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Company A only.',
        targetAccountIds: [f.accountA],
      }),
    );
    const decision = await verifier.verify(
      request({ dccContentId: created.id, companyId: f.companyB, channelId: 'engine-channel-a' }),
    );
    expect(decision).toEqual({ ok: false, reason: 'Content item not found.' });
  });

  it('a version number that does not exist does not verify', async () => {
    const created = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Only one version.',
        targetAccountIds: [f.accountA],
      }),
    );
    const decision = await verifier.verify(
      request({
        dccContentId: created.id,
        approvalVersion: 99,
        companyId: f.companyA,
        channelId: 'engine-channel-a',
      }),
    );
    expect(decision).toEqual({ ok: false, reason: 'That version does not exist.' });
  });
});

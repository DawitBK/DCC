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
 * Linking a registered account to a channel of the operational engine. Until an account is linked it
 * cannot be published to, and before this endpoint existed the link could be made only in the database.
 * accountA is a LinkedIn page of company A; accountB a Facebook page of company B.
 */
describe('engine channels and linking an account', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    await resetTestDatabase();
    f = await seedFixture();
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
  const link = (who: string, accountId: string, engineChannelId: string | null) =>
    send('PATCH', `/api/social-accounts/${accountId}/engine-channel`, who, { engineChannelId });

  it('says which engine is behind DCC, and that the fake one is not verified', async () => {
    const res = await send('GET', '/api/engine/status', 'adminA');
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      provider: 'fake',
      verification: 'unverified',
      canPublish: true,
    });
  });

  it('lists the engine channels for someone who manages accounts, and nobody else', async () => {
    const res = await send('GET', '/api/engine/channels', 'adminA');
    expect(res.status).toBe(200);
    const channels = await json(res);
    expect(channels.length).toBeGreaterThan(0);
    expect(channels.every((c: { linkedAccountId: unknown }) => c.linkedAccountId === null)).toBe(
      true,
    );
    expect((await send('GET', '/api/engine/channels', 'creatorB')).status).toBe(403);
  });

  it('links an account to a channel of the same network, audited, and the account then says so', async () => {
    const res = await link('adminA', f.accountA, 'fake-linkedin-1');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ id: f.accountA, engineChannelId: 'fake-linkedin-1' });

    const accounts = await json(await send('GET', '/api/social-accounts', 'adminA'));
    expect(accounts.find((a: { id: string }) => a.id === f.accountA).engineChannelId).toBe(
      'fake-linkedin-1',
    );
    const channels = await json(await send('GET', '/api/engine/channels', 'adminA'));
    expect(
      channels.find((c: { engineChannelId: string }) => c.engineChannelId === 'fake-linkedin-1')
        .linkedAccountId,
    ).toBe(f.accountA);

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const events = await owner.query(
      `select action, details from audit_events where target_id = $1 and action like 'account.engine%'`,
      [f.accountA],
    );
    await owner.end();
    expect(events.rows).toEqual([
      { action: 'account.engine_linked', details: { from: null, to: 'fake-linkedin-1' } },
    ]);
  });

  it('refuses a channel of another network, an unknown channel, and a channel that is already taken', async () => {
    const wrongNetwork = await link('adminA', f.accountA, 'fake-facebook-1');
    expect(wrongNetwork.status).toBe(400);
    expect((await json(wrongNetwork)).message).toMatch(/facebook channel.*registered as linkedin/);

    expect((await link('adminA', f.accountA, 'no-such-channel')).status).toBe(400);

    const second = await json(
      await send('POST', '/api/social-accounts', 'adminA', {
        companyId: f.companyA,
        platform: 'linkedin',
        displayName: 'Second LinkedIn page',
        handle: '@a-second',
        ownerUserId: f.users.adminA,
      }),
    );
    expect(second.id).toBeTruthy();
    const taken = await link('adminA', second.id, 'fake-linkedin-1');
    expect(taken.status).toBe(409);
  });

  it('another company cannot link or even see the account; a role without account.manage cannot link', async () => {
    expect((await link('creatorB', f.accountB, 'fake-facebook-1')).status).toBe(403);
    expect((await link('adminA', f.accountB, 'fake-facebook-1')).status).toBe(404);
    expect((await link('otherGroupAdmin', f.accountA, 'fake-linkedin-2')).status).toBe(404);
  });

  it('unlinks with null, audited', async () => {
    const res = await link('adminA', f.accountA, null);
    expect(res.status).toBe(200);
    expect((await json(res)).engineChannelId).toBeNull();
    const accounts = await json(await send('GET', '/api/social-accounts', 'adminA'));
    expect(accounts.find((a: { id: string }) => a.id === f.accountA).engineChannelId).toBeNull();
  });
});

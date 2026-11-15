import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';

/** Company and brand changes, the "company is not active" gate, the last administrator, the security overview. */
describe('company administration and the security overview', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let groupAdminMembership: string;
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
    await owner.query(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, null, 'security_admin')`,
      [f.users.auditorA, f.groupId],
    );
    await grant(f.users.outsider, 'company_executive');
    groupAdminMembership = (
      await owner.query(
        `select id from memberships where user_id = $1 and role = 'group_admin' and company_id is null`,
        [f.users.groupAdmin],
      )
    ).rows[0].id;
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

  it('a group administrator renames a company; a company administrator and another group cannot', async () => {
    const renamed = await send('PATCH', `/api/companies/${f.companyA}`, 'groupAdmin', {
      name: 'Company A renamed',
    });
    expect(renamed.status).toBe(200);
    expect((await json(renamed)).name).toBe('Company A renamed');
    expect(
      (await send('PATCH', `/api/companies/${f.companyA}`, 'adminA', { name: 'Mine now' })).status,
    ).toBe(403);
    expect(
      (await send('PATCH', `/api/companies/${f.companyA}`, 'otherGroupAdmin', { name: 'Theirs' }))
        .status,
    ).toBe(404);
    expect((await send('PATCH', `/api/companies/${f.companyA}`, 'groupAdmin', {})).status).toBe(
      400,
    );
  });

  it('a brand is renamed inside its own company only', async () => {
    const ok = await send(
      'PATCH',
      `/api/companies/${f.companyA}/brands/${f.brandA}`,
      'groupAdmin',
      { name: 'Brand A new' },
    );
    expect(ok.status).toBe(200);
    expect((await json(ok)).name).toBe('Brand A new');
    // brand B does not belong to company A
    expect(
      (
        await send('PATCH', `/api/companies/${f.companyA}/brands/${f.brandB}`, 'groupAdmin', {
          name: 'Wrong company',
        })
      ).status,
    ).toBe(404);
  });

  it('a suspended company publishes nothing, even approved content; re-activated, it publishes again', async () => {
    const item = await json(
      await send('POST', '/api/content-items', 'adminA', {
        companyId: f.companyA,
        body: 'Approved before the suspension.',
        targetAccountIds: [f.accountA],
      }),
    );
    const request = await json(
      await send('POST', `/api/content-items/${item.id}/submit`, 'adminA'),
    );
    expect(
      (
        await json(
          await send('POST', `/api/approval-requests/${request.id}/approve`, 'auditorA', {}),
        )
      ).status,
    ).toBe('approved');

    expect(
      (await send('PATCH', `/api/companies/${f.companyA}`, 'groupAdmin', { status: 'suspended' }))
        .status,
    ).toBe(200);
    const publish = () =>
      send('POST', `/api/content-items/${item.id}/publish`, 'outsider', {
        socialAccountId: f.accountA,
      });
    const refused = await publish();
    expect(refused.status).toBe(403);

    await send('PATCH', `/api/companies/${f.companyA}`, 'groupAdmin', { status: 'active' });
    expect((await publish()).status).toBe(201);
  });

  it('the last group administrator cannot be removed', async () => {
    const res = await send('DELETE', `/api/memberships/${groupAdminMembership}`, 'groupAdmin');
    expect(res.status).toBe(409);
    expect((await json(res)).message).toMatch(/last group administrator/);
  });

  it('the security overview shows what is known, names what is not monitored, and is closed to others', async () => {
    const res = await send('GET', '/api/security/posture', 'auditorA');
    expect(res.status).toBe(200);
    const p = await json(res);
    expect(p.auditTrail.chainOk).toBe(true);
    expect(p.accounts).toMatchObject({ total: 2, notConnectedToEngine: 1 });
    expect(p.notMonitored.length).toBeGreaterThan(0);
    expect(p.twoFactorSignIn.enforced).toBeTypeOf('boolean');
    expect((await send('GET', '/api/security/posture', 'creatorB')).status).toBe(403);
  });
});

import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SweepService } from '../src/modules/working-hours/sweep.service';
import { SessionService } from '../src/platform/auth/session.service';
import { TenantDb } from '../src/platform/tenancy/tenant-db';
import {
  ctx,
  listenForTests,
  ownerUrl,
  resetTestDatabase,
  seedFixture,
  type Fixture,
} from './helpers';

const ORIGIN = 'http://localhost:7717';

/** Round 2 base: the working calendar of a company, the sweep, and the walls around the escalation record. */
describe('working hours and the sweep (Round 2 base)', () => {
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

  const monSat = {
    workDays: [1, 2, 3, 4, 5, 6],
    startMinute: 510,
    endMinute: 1050,
    utcOffsetMinutes: 180,
    holidays: [] as string[],
  };

  it('a company with nothing set has the default calendar (Monday to Saturday 08:30 to 17:30)', async () => {
    const r = await send('GET', `/api/working-hours?companyId=${f.companyA}`, 'adminA');
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ ...monSat, custom: false, updatedAt: null });
  });

  it('a company administrator sets it, and the change is audited with before and after', async () => {
    const r = await send('PUT', '/api/working-hours', 'adminA', {
      companyId: f.companyA,
      ...monSat,
      workDays: [1, 2, 3, 4, 5],
      holidays: ['2026-12-25', '2026-11-30', '2026-11-30'],
    });
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body).toMatchObject({ workDays: [1, 2, 3, 4, 5], custom: true });
    expect(body.holidays).toEqual(['2026-11-30', '2026-12-25']);

    const again = await json(
      await send('GET', `/api/working-hours?companyId=${f.companyA}`, 'adminA'),
    );
    expect(again.holidays).toEqual(['2026-11-30', '2026-12-25']);

    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const { rows } = await owner.query(
      `select details from audit_events where action = 'working_hours.set' and company_id = $1`,
      [f.companyA],
    );
    await owner.end();
    expect(rows).toHaveLength(1);
    expect(rows[0].details.from.workDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows[0].details.to.workDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('refuses a day that ends before it starts, and a day number that does not exist', async () => {
    const bad = await send('PUT', '/api/working-hours', 'adminA', {
      companyId: f.companyA,
      ...monSat,
      startMinute: 900,
      endMinute: 600,
    });
    expect(bad.status).toBe(400);
    const badDay = await send('PUT', '/api/working-hours', 'adminA', {
      companyId: f.companyA,
      ...monSat,
      workDays: [7],
    });
    expect(badDay.status).toBe(400);
  });

  it("another company's person cannot read or change this company's hours; an auditor cannot change them", async () => {
    expect(
      (await send('GET', `/api/working-hours?companyId=${f.companyA}`, 'creatorB')).status,
    ).toBeGreaterThanOrEqual(403);
    expect(
      (await send('PUT', '/api/working-hours', 'creatorB', { companyId: f.companyA, ...monSat }))
        .status,
    ).toBeGreaterThanOrEqual(403);
    expect(
      (await send('PUT', '/api/working-hours', 'auditorA', { companyId: f.companyA, ...monSat }))
        .status,
    ).toBe(403);
  });

  it('attack: row-level security hides the hours and the escalation record of another company', async () => {
    const tenant = app.get(TenantDb);
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    await owner.query(
      `insert into escalation_events (company_id, kind, target_id, level) values ($1, 'inbox', gen_random_uuid(), 1)`,
      [f.companyA],
    );
    await owner.end();
    // A person of company B sees none of company A's rows ...
    await tenant.run(ctx(f.users.creatorB, [], [f.companyB]), async (trx) => {
      expect(await trx.selectFrom('company_working_hours').selectAll().execute()).toHaveLength(0);
      expect(await trx.selectFrom('escalation_events').selectAll().execute()).toHaveLength(0);
    });
    // ... and cannot write one for company A either (the whole transaction is refused).
    await expect(
      tenant.run(ctx(f.users.creatorB, [], [f.companyB]), (trx) =>
        trx
          .insertInto('escalation_events')
          .values({ company_id: f.companyA, kind: 'inbox', target_id: f.companyA, level: 1 })
          .execute(),
      ),
    ).rejects.toThrow();
    // The group administrator of the same group sees company A's.
    await tenant.run(ctx(f.users.groupAdmin, [f.groupId], []), async (trx) => {
      expect(await trx.selectFrom('escalation_events').selectAll().execute()).toHaveLength(1);
    });
  });

  it('one level is recorded once: the same (kind, target, level) cannot be inserted twice', async () => {
    const tenant = app.get(TenantDb);
    const target = '11111111-1111-4111-8111-111111111111';
    await tenant.run(ctx(f.users.adminA, [], [f.companyA]), async (trx) => {
      await trx
        .insertInto('escalation_events')
        .values({ company_id: f.companyA, kind: 'approval', target_id: target, level: 2 })
        .execute();
      const again = await trx
        .insertInto('escalation_events')
        .values({ company_id: f.companyA, kind: 'approval', target_id: target, level: 2 })
        .onConflict((oc) => oc.columns(['kind', 'target_id', 'level']).doNothing())
        .returning('id')
        .execute();
      expect(again).toHaveLength(0);
    });
  });

  it('the sweep runs every registered job for every active company and one failure does not stop the rest', async () => {
    const sweep = app.get(SweepService);
    const seen: string[] = [];
    sweep.register('test-ok', async (companyId) => {
      seen.push(companyId);
    });
    sweep.register('test-boom', async () => {
      throw new Error('boom');
    });
    const quiet = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const failures = await sweep.runOnce(new Date());
    quiet.mockRestore();
    expect(new Set(seen)).toEqual(new Set([f.companyA, f.companyB, f.company2]));
    expect(failures.filter((x) => x.job === 'test-boom')).toHaveLength(3);
    expect(failures.every((x) => x.error === 'boom')).toBe(true);
  });
});

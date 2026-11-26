import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FakeEngine } from '@dcc/engine-client';
import pg from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ApprovalClockService } from '../src/modules/content/approval-clock.service';
import { OPERATIONAL_ENGINE } from '../src/modules/publishing/operational-engine.provider';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

export const ORIGIN = 'http://localhost:7717';

/**
 * The world the Round 2 approval tests share (a fresh scratch database per test file).
 *
 * Company A people:
 *   writer  (adminA)   company_admin + content_creator     writes the content, sets policies and working hours
 *   mgr     (auditorA) company_marketing_manager           reviews, approves, publishes (the Digital Marketing Manager)
 *   mgr2               company_marketing_manager           a second one
 *   exec    (outsider) company_executive                   approves, publishes, may approve in an emergency
 *   exec2              company_executive                   a second one
 *   dual               content_creator + company_executive writes AND holds the approve and emergency permissions
 *   gm                 group_marketing (group level)       the Group marketing and communications role
 * Company B: execB (company_executive), plus the fixture's creatorB (content_creator).
 */
export interface World {
  app: INestApplication;
  f: Fixture;
  engine: FakeEngine;
  clock: ApprovalClockService;
  ids: Record<
    'writer' | 'mgr' | 'mgr2' | 'exec' | 'exec2' | 'dual' | 'gm' | 'execB' | 'groupAdmin',
    string
  >;
  send: (method: string, path: string, who: string, body?: unknown) => Promise<Response>;
  json: (r: Response) => Promise<any>;
  q: <T = any>(text: string, values?: unknown[]) => Promise<T[]>;
  close: () => Promise<void>;
  draft: (who: string, body: string, categoryId?: string) => Promise<any>;
  submit: (who: string, itemId: string) => Promise<any>;
  /** A draft submitted and left pending. */
  pending: (body: string, categoryId?: string) => Promise<{ item: any; request: any }>;
  /** A draft submitted and approved by one person (the default rule: one approver). */
  approved: (body: string) => Promise<{ item: any; request: any }>;
  category: (key: string, name: string) => Promise<string>;
  policy: (
    categoryId: string | null,
    rule: {
      requiredApprovals: number;
      approverRoles?: string[];
      timeLimitHours?: number | null;
      clock?: 'working' | 'continuous';
    },
  ) => Promise<any>;
  notified: (targetId: string, eventType: string) => Promise<string[]>;
  audit: (targetId: string, action: string) => Promise<any[]>;
}

const NAMES = [
  'writer',
  'mgr',
  'mgr2',
  'exec',
  'exec2',
  'dual',
  'gm',
  'execB',
  'groupAdmin',
] as const;

export async function bootWorld(): Promise<World> {
  await resetTestDatabase();
  const f = await seedFixture();
  const owner = new pg.Client({ connectionString: ownerUrl() });
  await owner.connect();
  const q = async <T = any>(text: string, values: unknown[] = []): Promise<T[]> =>
    (await owner.query(text, values)).rows as T[];
  const user = async (n: string) =>
    (
      await q<{ id: string }>(
        `insert into users (idp_subject, email, display_name) values ($1, $2, $1) returning id`,
        [`sub-${n}`, `${n}@example.test`],
      )
    )[0]!.id;
  const grant = (userId: string, role: string, companyId: string | null) =>
    q(`insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`, [
      userId,
      f.groupId,
      companyId,
      role,
    ]);
  const ids = {
    writer: f.users.adminA,
    mgr: f.users.auditorA,
    exec: f.users.outsider,
    groupAdmin: f.users.groupAdmin,
    mgr2: await user('mgr2'),
    exec2: await user('exec2'),
    dual: await user('dual'),
    gm: await user('gm'),
    execB: await user('exec-b'),
  };
  await grant(ids.writer, 'content_creator', f.companyA);
  await grant(ids.mgr, 'company_marketing_manager', f.companyA);
  await grant(ids.mgr2, 'company_marketing_manager', f.companyA);
  await grant(ids.exec, 'company_executive', f.companyA);
  await grant(ids.exec2, 'company_executive', f.companyA);
  await grant(ids.dual, 'content_creator', f.companyA);
  await grant(ids.dual, 'company_executive', f.companyA);
  await grant(ids.gm, 'group_marketing', null);
  await grant(ids.execB, 'company_executive', f.companyB);
  await q(`update social_accounts set engine_channel_id = 'fake-linkedin-a' where id = $1`, [
    f.accountA,
  ]);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  const base = await listenForTests(app);
  const sessions = app.get(SessionService);
  const cookies = new Map<string, string>();
  for (const name of NAMES)
    cookies.set(name, `dcc_sid=${(await sessions.create({ userId: ids[name] })).id}`);
  cookies.set('creatorB', `dcc_sid=${(await sessions.create({ userId: f.users.creatorB })).id}`);

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

  const draft = async (who: string, body: string, categoryId?: string) => {
    const res = await send('POST', '/api/content-items', who, {
      companyId: f.companyA,
      body,
      targetAccountIds: [f.accountA],
      ...(categoryId ? { categoryId } : {}),
    });
    if (res.status !== 201) throw new Error(`draft failed: ${res.status} ${await res.text()}`);
    return json(res);
  };
  const submit = async (who: string, itemId: string) => {
    const res = await send('POST', `/api/content-items/${itemId}/submit`, who);
    if (res.status !== 201) throw new Error(`submit failed: ${res.status} ${await res.text()}`);
    return json(res);
  };
  const pending = async (body: string, categoryId?: string) => {
    const item = await draft('writer', body, categoryId);
    return { item, request: await submit('writer', item.id) };
  };
  const approved = async (body: string) => {
    const { item, request } = await pending(body);
    const res = await send('POST', `/api/approval-requests/${request.id}/approve`, 'mgr', {});
    if (res.status !== 201) throw new Error(`approve failed: ${res.status} ${await res.text()}`);
    return { item, request: await json(res) };
  };
  const category = async (key: string, name: string) => {
    const res = await send('POST', '/api/content-categories', 'groupAdmin', { key, name });
    if (res.status !== 201) throw new Error(`category failed: ${res.status} ${await res.text()}`);
    return (await json(res)).id as string;
  };
  const policy = async (
    categoryId: string | null,
    rule: {
      requiredApprovals: number;
      approverRoles?: string[];
      timeLimitHours?: number | null;
      clock?: 'working' | 'continuous';
    },
  ) => {
    const res = await send('PUT', '/api/approval-policies', 'writer', {
      companyId: f.companyA,
      categoryId,
      approverRoles: [],
      ...rule,
    });
    if (res.status !== 200) throw new Error(`policy failed: ${res.status} ${await res.text()}`);
    return json(res);
  };
  const notified = async (targetId: string, eventType: string) =>
    (
      await q<{ recipient_user_id: string }>(
        `select recipient_user_id from notifications where target_id = $1 and event_type = $2`,
        [targetId, eventType],
      )
    ).map((r) => r.recipient_user_id);
  const audit = (targetId: string, action: string) =>
    q(
      `select action, actor_user_id, actor_subject, details from audit_events where target_id = $1 and action = $2 order by id`,
      [targetId, action],
    );

  return {
    app,
    f,
    engine: app.get(OPERATIONAL_ENGINE) as FakeEngine,
    clock: app.get(ApprovalClockService),
    ids,
    send,
    json,
    q,
    draft,
    submit,
    pending,
    approved,
    category,
    policy,
    notified,
    audit,
    close: async () => {
      await owner.end();
      await app.close();
    },
  };
}

/** Sets when a request was submitted, to control a clock without waiting for it. */
export const setRequestedAt = (w: World, requestId: string, at: string) =>
  w.q(`update approval_requests set requested_at = $2 where id = $1`, [requestId, at]);

/** Runs the approvals sweep for company A as it would run at `now`. */
export const sweepAt = (w: World, now: string, companyId = w.f.companyA) =>
  w.clock.runForCompany(companyId, new Date(now));

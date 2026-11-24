import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FakeEngine } from '@dcc/engine-client';
import pg from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OPERATIONAL_ENGINE } from '../src/modules/publishing/operational-engine.provider';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

export const ORIGIN = 'http://localhost:7717';

export interface MembershipSpec {
  role: string;
  /** null = group-level (applies to every company of `groupId`). */
  companyId: string | null;
  groupId: string;
}

/**
 * The shared setup of the integration-plan tests (docs/testing/INTEGRATION-TEST-PLAN.md, L-18 / H-13): the real
 * application against the scratch PostgreSQL, the fake engine, the fixture world of `seedFixture`, and a helper that
 * makes a person with exactly the roles a test needs. Every call goes through HTTP, as the web app's would.
 */
export class PlanHarness {
  app!: INestApplication;
  base!: string;
  f!: Fixture;
  fake!: FakeEngine;
  sessions!: SessionService;
  readonly cookies = new Map<string, string>();
  readonly userIds = new Map<string, string>();
  private counter = 0;

  /** Resets the scratch database, seeds the fixture, connects the fixture's two accounts to the fake engine, starts the app. */
  async start(channels: { a: string; b: string } = { a: 'plan-channel-a', b: 'plan-channel-b' }) {
    await resetTestDatabase();
    this.f = await seedFixture();
    await this.owner(async (db) => {
      await db.query(`update social_accounts set engine_channel_id = $2 where id = $1`, [
        this.f.accountA,
        channels.a,
      ]);
      await db.query(`update social_accounts set engine_channel_id = $2 where id = $1`, [
        this.f.accountB,
        channels.b,
      ]);
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    this.app = moduleRef.createNestApplication();
    configureApp(this.app);
    this.base = await listenForTests(this.app);
    this.fake = this.app.get(OPERATIONAL_ENGINE);
    this.sessions = this.app.get(SessionService);
    for (const [name, id] of Object.entries(this.f.users)) {
      this.userIds.set(name, id);
      this.cookies.set(name, await this.cookie(id));
    }
    return this;
  }

  async stop() {
    await this.app.close();
  }

  private async cookie(userId: string, authenticatedAt?: Date | null) {
    return `dcc_sid=${(await this.sessions.create({ userId, authenticatedAt })).id}`;
  }

  /** Runs `fn` as the database OWNER (bypasses row-level security): for seeding and for reading what the API really stored. */
  async owner<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
    const db = new pg.Client({ connectionString: ownerUrl() });
    await db.connect();
    try {
      return await fn(db);
    } finally {
      await db.end();
    }
  }

  async query(text: string, values: unknown[] = []): Promise<any[]> {
    return this.owner(async (db) => (await db.query(text, values)).rows);
  }

  /** A new person holding exactly these roles (one session, signed in just now). */
  async persona(name: string, memberships: MembershipSpec[]): Promise<string> {
    const n = ++this.counter;
    const id = await this.owner(async (db) => {
      const user = await db.query(
        `insert into users (idp_subject, email, display_name) values ($1, $2, $3) returning id`,
        [`sub-plan-${name}-${n}`, `${name}-${n}@example.test`, name],
      );
      for (const m of memberships)
        await db.query(
          `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`,
          [user.rows[0].id, m.groupId, m.companyId, m.role],
        );
      return user.rows[0].id as string;
    });
    this.userIds.set(name, id);
    this.cookies.set(name, await this.cookie(id));
    return id;
  }

  /** Another session for an existing person whose sign-in at the SSO was `minutes` ago (for the "sign in again" rule). */
  async staleSession(name: string, minutes: number): Promise<string> {
    const stale = await this.cookie(
      this.userIds.get(name)!,
      new Date(Date.now() - minutes * 60_000),
    );
    this.cookies.set(`${name}:stale`, stale);
    return `${name}:stale`;
  }

  send = (
    method: string,
    path: string,
    who: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${this.base}${path}`, {
      method,
      redirect: 'manual',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        cookie: this.cookies.get(who)!,
        origin: ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
    });

  json = async (r: Response) => r.json() as Promise<any>;

  /** Writes, submits and approves a post for company A (or the given company/account); returns the item and the approval request. */
  async approvedItem(opts: {
    text: string;
    author: string;
    approver: string;
    companyId: string;
    accountId: string;
  }) {
    const item = await this.json(
      await this.send('POST', '/api/content-items', opts.author, {
        companyId: opts.companyId,
        body: opts.text,
        targetAccountIds: [opts.accountId],
      }),
    );
    const request = await this.json(
      await this.send('POST', `/api/content-items/${item.id}/submit`, opts.author),
    );
    const approved = await this.send(
      'POST',
      `/api/approval-requests/${request.id}/approve`,
      opts.approver,
      {},
    );
    if (approved.status >= 300) throw new Error(`approve failed: ${approved.status}`);
    return { item, request };
  }
}

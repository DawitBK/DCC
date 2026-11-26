import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FakeEngine, InboxMessage } from '@dcc/engine-client';
import pg from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OPERATIONAL_ENGINE } from '../src/modules/publishing/operational-engine.provider';
import { SessionService } from '../src/platform/auth/session.service';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

export const ORIGIN = 'http://localhost:7717';
export const MINUTE = 60_000;

/**
 * Shared set-up of the Round 2 "replies" tests: the fixture world, two linked accounts (A and B) and these people.
 *   writerA   content_creator, company A     reads, replies, hides (no delete, no approve)
 *   mgrA      company_marketing_manager, A   approves, replies, hides, deletes, blocks, manages the inbox
 *   execA     company_executive, A           approves, replies, manages the inbox (cannot moderate)
 *   exec2A    company_executive, A           a second approver
 *   groupMkt  group_marketing (group level)  approves for every company of the group (cannot reply)
 *   adminA    company_admin, A (fixture)     manages the inbox, cannot approve, cannot reply
 *   writerB   content_creator, company B     the other company
 *   mgrB      company_marketing_manager, B   the other company's manager
 */
export async function startHarness() {
  await resetTestDatabase();
  const f: Fixture = await seedFixture();
  const owner = new pg.Client({ connectionString: ownerUrl() });
  await owner.connect();
  const ownerQuery = async (text: string, values: unknown[] = []) =>
    (await owner.query(text, values)).rows as any[];
  await ownerQuery(`update social_accounts set engine_channel_id = 'fake-linkedin-1' where id = $1`, [
    f.accountA,
  ]);
  await ownerQuery(`update social_accounts set engine_channel_id = 'fake-facebook-1' where id = $1`, [
    f.accountB,
  ]);
  const people: Record<string, string> = { ...f.users };
  const make = async (name: string, companyId: string | null, role: string) => {
    const id = (
      await ownerQuery(
        `insert into users (idp_subject, email, display_name) values ($1, $2, $3) returning id`,
        [`sub-${name}`, `${name}@example.test`, name],
      )
    )[0].id as string;
    await ownerQuery(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, $4)`,
      [id, f.groupId, companyId, role],
    );
    people[name] = id;
  };
  await make('writerA', f.companyA, 'content_creator');
  await make('mgrA', f.companyA, 'company_marketing_manager');
  await make('execA', f.companyA, 'company_executive');
  await make('exec2A', f.companyA, 'company_executive');
  await make('groupMkt', null, 'group_marketing');
  await make('writerB', f.companyB, 'content_creator');
  await make('mgrB', f.companyB, 'company_marketing_manager');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  configureApp(app);
  const base = await listenForTests(app);
  const fake = app.get(OPERATIONAL_ENGINE) as FakeEngine;
  const sessions = app.get(SessionService);
  const cookies = new Map<string, string>();
  for (const [name, id] of Object.entries(people)) {
    cookies.set(name, `dcc_sid=${(await sessions.create({ userId: id })).id}`);
  }

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

  let counter = 0;
  /** Puts a message into the fake engine (channel A is LinkedIn 1, channel B is Facebook 1). */
  const addMessage = (
    id: string,
    options: { channel?: string; text?: string; receivedAt?: Date; replied?: boolean; author?: string } = {},
  ): InboxMessage => {
    counter += 1;
    const message: InboxMessage = {
      engineMessageId: id,
      engineChannelId: options.channel ?? 'fake-linkedin-1',
      kind: 'comment',
      authorName: options.author ?? `Customer ${counter}`,
      text: options.text ?? `Text of ${id}`,
      receivedAt: options.receivedAt ?? new Date(Date.now() - 5 * MINUTE),
      engineOperationId: null,
      replied: options.replied ?? false,
    };
    fake.inboxMessages.push(message);
    return message;
  };

  return {
    app,
    f,
    fake,
    people,
    send,
    json,
    addMessage,
    query: ownerQuery,
    async stop() {
      await app.close();
      await owner.end();
    },
  };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;

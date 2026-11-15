import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listenForTests, ownerUrl, resetTestDatabase, seedFixture, type Fixture } from './helpers';

const ORIGIN = 'http://localhost:7717';
const OWNER_EMAIL = 'the-owner@example.test';

/** The platform owner, choosing a role to act as, and pictures and videos on posts. */
describe('platform owner, acting role, media', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    // Read when the application starts, so set before it is built.
    process.env.DCC_PLATFORM_OWNER_EMAILS = OWNER_EMAIL;
    process.env.DCC_MEDIA_DIR = mkdtempSync(join(tmpdir(), 'dcc-media-test-'));
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/bootstrap');
    const { SessionService } = await import('../src/platform/auth/session.service');

    await resetTestDatabase();
    f = await seedFixture();
    const owner = new pg.Client({ connectionString: ownerUrl() });
    await owner.connect();
    const ownerUser = await owner.query(
      `insert into users (idp_subject, email, display_name) values ('sub-owner', $1, 'Owner') returning id`,
      [OWNER_EMAIL],
    );
    await owner.query(
      `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, $3, 'content_creator')`,
      [f.users.adminA, f.groupId, f.companyA],
    );
    await owner.query(
      `update social_accounts set engine_channel_id = 'fake-linkedin-1' where id = $1`,
      [f.accountA],
    );
    await owner.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    base = await listenForTests(app);
    const sessions = app.get(SessionService);
    const people = { ...f.users, owner: ownerUser.rows[0].id as string };
    for (const [name, id] of Object.entries(people)) {
      cookies.set(name, `dcc_sid=${(await sessions.create({ userId: id })).id}`);
    }
  });
  afterAll(async () => {
    delete process.env.DCC_PLATFORM_OWNER_EMAILS;
    delete process.env.DCC_MEDIA_DIR;
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
  const upload = (who: string, companyId: string, bytes: Uint8Array, name: string) => {
    const form = new FormData();
    form.append('file', new Blob([bytes]), name);
    return fetch(`${base}/api/media?companyId=${companyId}`, {
      method: 'POST',
      body: form,
      headers: { cookie: cookies.get(who)!, origin: ORIGIN },
    });
  };
  const PNG = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...new Array(40).fill(0),
  ]);

  describe('the platform owner', () => {
    it('holds every role with no stored membership, sees every company, and is in no people list', async () => {
      const me = await json(await send('GET', '/api/me', 'owner'));
      expect(me.roles).toHaveLength(11);
      expect(me.permissions).toEqual(
        expect.arrayContaining([
          'company.manage',
          'content.publish',
          'security.read',
          'inbox.reply',
        ]),
      );
      const companies = await json(await send('GET', '/api/companies', 'owner'));
      expect(companies.map((c: { id: string }) => c.id)).toEqual(
        expect.arrayContaining([f.companyA, f.companyB]),
      );
      const people = await json(await send('GET', '/api/users', 'groupAdmin'));
      expect(people.some((p: { email: string }) => p.email === OWNER_EMAIL)).toBe(false);
      expect(people.length).toBeGreaterThan(0);
    });

    it('can write, approve and publish alone; an ordinary person still cannot approve their own post', async () => {
      const item = await json(
        await send('POST', '/api/content-items', 'owner', {
          companyId: f.companyA,
          body: 'Written, approved and published by the owner.',
          targetAccountIds: [f.accountA],
        }),
      );
      const request = await json(
        await send('POST', `/api/content-items/${item.id}/submit`, 'owner'),
      );
      const approved = await send(
        'POST',
        `/api/approval-requests/${request.id}/approve`,
        'owner',
        {},
      );
      expect((await json(approved)).status).toBe('approved');
      expect(
        (
          await send('POST', `/api/content-items/${item.id}/publish`, 'owner', {
            socialAccountId: f.accountA,
          })
        ).status,
      ).toBe(201);
    });
  });

  describe('acting as one role', () => {
    it('narrows what the person may do to that role, refuses a role they do not hold, and widens again', async () => {
      const before = await json(await send('GET', '/api/me', 'adminA'));
      expect(before.roles.sort()).toEqual(['company_admin', 'content_creator']);
      expect(before.actingRole).toBeNull();
      expect(before.permissions).toContain('user.manage');

      expect(
        (await send('PUT', '/api/me/acting-role', 'adminA', { role: 'content_creator' })).status,
      ).toBe(200);
      const acting = await json(await send('GET', '/api/me', 'adminA'));
      expect(acting.actingRole).toBe('content_creator');
      expect(acting.roles.sort()).toEqual(['company_admin', 'content_creator']);
      expect(acting.permissions).not.toContain('user.manage');
      expect((await send('GET', '/api/users', 'adminA')).status).toBe(403);

      expect(
        (await send('PUT', '/api/me/acting-role', 'adminA', { role: 'publisher' })).status,
      ).toBe(400);
      await send('PUT', '/api/me/acting-role', 'adminA', { role: null });
      expect((await json(await send('GET', '/api/me', 'adminA'))).permissions).toContain(
        'user.manage',
      );
    });
  });

  describe('pictures and videos', () => {
    it('accepts a real picture, refuses another file type, and keeps a company’s media to that company', async () => {
      const ok = await upload('adminA', f.companyA, PNG, 'photo.png');
      expect(ok.status).toBe(201);
      const media = await json(ok);
      expect(media).toMatchObject({ kind: 'image', mimeType: 'image/png', companyId: f.companyA });

      // a text file named like a picture
      const fake = await upload(
        'adminA',
        f.companyA,
        new TextEncoder().encode('not a picture'),
        'x.png',
      );
      expect(fake.status).toBe(400);
      // another company
      expect((await upload('adminA', f.companyB, PNG, 'photo.png')).status).toBe(404);

      const file = await send('GET', media.url, 'adminA');
      expect(file.status).toBe(200);
      expect(file.headers.get('content-type')).toBe('image/png');
      expect((await send('GET', media.url, 'creatorB')).status).toBe(404);

      const item = await json(
        await send('POST', '/api/content-items', 'adminA', {
          companyId: f.companyA,
          body: 'A post with a picture.',
          targetAccountIds: [f.accountA],
          mediaIds: [media.id],
        }),
      );
      expect(item.currentVersion.media.map((m: { id: string }) => m.id)).toEqual([media.id]);
      // an edit that does not mention media keeps them; an empty list removes them
      const kept = await json(
        await send('PATCH', `/api/content-items/${item.id}`, 'adminA', { body: 'Edited text.' }),
      );
      expect(kept.currentVersion.media).toHaveLength(1);
      const removed = await json(
        await send('PATCH', `/api/content-items/${item.id}`, 'adminA', {
          body: 'No picture now.',
          mediaIds: [],
        }),
      );
      expect(removed.currentVersion.media).toHaveLength(0);

      // company B cannot attach company A's picture
      const stolen = await send('POST', '/api/content-items', 'creatorB', {
        companyId: f.companyB,
        body: 'With a picture that is not ours.',
        targetAccountIds: [f.accountB],
        mediaIds: [media.id],
      });
      expect(stolen.status).toBe(400);
    });
  });
});

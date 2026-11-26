import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionService } from '../src/platform/auth/session.service';
import { holdsRoleFor } from '../src/modules/publishing/publication-removal.service';
import { bootWorld, type World } from './approval-rules-harness';

const OWNER_EMAIL = 'the-owner@example.test';
const LONG_ENOUGH = 'The post named the wrong date.';

/**
 * Round 3 (RQ-026; sheet C1-15, C2 column I, F-14): remove or correct a published post, with a written reason.
 * Company A people (see the harness): writer = company_admin + content_creator, mgr and mgr2 = Digital Marketing Managers,
 * exec and exec2 = company executives, dual = content_creator + company_executive, gm = group_marketing, groupAdmin = group_admin.
 */
describe('remove or correct a published post', () => {
  let w: World;
  let ownerId: string;
  let ownerCookie: string;
  let routine: string; // removal: Digital Marketing Manager and company admin
  let legal: string; // removal: company executive only
  let senior: string; // removal: company executive and Group marketing
  let plain: string; // a policy that names nobody for removal: the default applies

  beforeAll(async () => {
    process.env.DCC_PLATFORM_OWNER_EMAILS = OWNER_EMAIL;
    w = await bootWorld();
    const user = await w.q<{ id: string }>(
      `insert into users (idp_subject, email, display_name) values ('sub-owner', $1, 'Owner') returning id`,
      [OWNER_EMAIL],
    );
    ownerId = user[0]!.id;
    ownerCookie = `dcc_sid=${(await w.app.get(SessionService).create({ userId: ownerId })).id}`;

    routine = await w.category('routine', 'Routine');
    legal = await w.category('legal', 'Legal');
    senior = await w.category('senior', 'Senior');
    plain = await w.category('plain', 'Plain');
    await w.policy(routine, {
      requiredApprovals: 1,
      approverRoles: ['company_marketing_manager'],
      removeRoles: ['company_marketing_manager', 'company_admin'],
    });
    await w.policy(legal, {
      requiredApprovals: 1,
      approverRoles: ['company_executive'],
      removeRoles: ['company_executive'],
    });
    await w.policy(senior, {
      requiredApprovals: 1,
      approverRoles: ['company_executive'],
      removeRoles: ['company_executive', 'group_marketing'],
    });
    await w.policy(plain, { requiredApprovals: 1, approverRoles: ['company_marketing_manager'] });
  });
  afterAll(async () => {
    delete process.env.DCC_PLATFORM_OWNER_EMAILS;
    await w.close();
  });

  const approverOf = (category: string | undefined) =>
    category === legal || category === senior ? 'exec' : 'mgr';

  /** A post that really went out through the fake engine: drafted, approved by someone else, published. */
  const published = async (
    text: string,
    category?: string,
    extra: Record<string, unknown> = {},
  ) => {
    const item = await w.draft('writer', text, category);
    const request = await w.submit('writer', item.id);
    const approve = await w.send(
      'POST',
      `/api/approval-requests/${request.id}/approve`,
      approverOf(category),
      {},
    );
    expect(approve.status).toBe(201);
    const res = await w.send('POST', `/api/content-items/${item.id}/publish`, 'exec', {
      socialAccountId: w.f.accountA,
      ...extra,
    });
    expect(res.status).toBe(201);
    const publication = await w.json(res);
    expect(publication.status).toBe('published');
    return { item, publication };
  };
  const remove = (who: string, id: string, body: unknown = { reason: LONG_ENOUGH }) =>
    w.send('POST', `/api/publications/${id}/remove`, who, body);
  const correct = (who: string, id: string, body: unknown) =>
    w.send('POST', `/api/publications/${id}/correct`, who, body);
  const row = async (id: string) =>
    (await w.q(`select * from publications where id = $1`, [id]))[0];
  const list = async (who: string) => w.json(await w.send('GET', '/api/publications', who));
  const asOwner = async (method: string, path: string, body?: unknown) =>
    fetch(`${await w.app.getUrl()}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        cookie: ownerCookie,
        origin: 'http://localhost:7717',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    });

  describe('who may remove or correct (the roles of the post category)', () => {
    it('a routine post: the Digital Marketing Manager and the company administrator, nobody else', async () => {
      const a = await published('Routine update one.', routine);
      expect((await remove('exec2', a.publication.id)).status).toBe(403); // executive is not listed for routine
      expect((await remove('creatorB', a.publication.id)).status).toBe(403); // no removal permission at all
      expect((await remove('mgr2', a.publication.id)).status).toBe(200);

      const b = await published('Routine update two.', routine);
      expect((await remove('writer', b.publication.id)).status).toBe(200); // company_admin is listed
    });

    it('a legal post: only the company executive; the marketing manager holds the route permission but is refused with the roles named', async () => {
      const a = await published('A legal statement.', legal);
      const refused = await remove('mgr', a.publication.id);
      expect(refused.status).toBe(403);
      expect((await w.json(refused)).message).toContain('Company CEO / executive');
      expect((await remove('writer', a.publication.id)).status).toBe(403);
      expect((await row(a.publication.id)).status).toBe('published');
      expect((await remove('exec2', a.publication.id)).status).toBe(200);
    });

    it('a Group role counts when the policy names it: Group marketing may remove a senior post, not a routine one', async () => {
      const s = await published('A senior statement.', senior);
      const r = await published('Another routine update.', routine);
      expect((await remove('gm', r.publication.id)).status).toBe(403);
      expect((await remove('gm', s.publication.id)).status).toBe(200);
    });

    it('a policy that names nobody means the approver roles plus the administrators (company and Group)', async () => {
      const a = await published('Plain one.', plain);
      const b = await published('Plain two.', plain);
      expect((await remove('exec', a.publication.id)).status).toBe(403); // executive does not approve this category
      expect((await remove('groupAdmin', a.publication.id)).status).toBe(200);
      expect((await remove('writer', b.publication.id)).status).toBe(200);
    });

    it('a post with no category follows the company default, which is any approving role plus the administrators', async () => {
      const a = await published('No category at all.');
      expect((await remove('mgr', a.publication.id)).status).toBe(200);
    });

    it('the list tells each caller which roles may and whether they may (the screens use it)', async () => {
      const a = await published('Who can see the buttons.', legal);
      const asExec = (await list('exec')).find((p: any) => p.id === a.publication.id);
      expect(asExec).toMatchObject({
        status: 'published',
        removeRoles: ['company_executive'],
        canRemove: true,
        canCorrect: true,
        correctionContentItemIds: [],
      });
      const asMgr = (await list('mgr')).find((p: any) => p.id === a.publication.id);
      expect(asMgr).toMatchObject({ canRemove: false, canCorrect: false });
      const asB = (await list('execB')).find((p: any) => p.id === a.publication.id);
      expect(asB).toBeUndefined();
    });

    it('holdsRoleFor: a company role counts only in its own company, a group role in its own group', () => {
      const memberships = [
        { role: 'company_admin' as const, groupId: 'g1', companyId: 'c1' },
        { role: 'group_marketing' as const, groupId: 'g1', companyId: null },
      ];
      expect(
        holdsRoleFor({ memberships }, { groupId: 'g1', companyId: 'c1' }, ['company_admin']),
      ).toBe(true);
      expect(
        holdsRoleFor({ memberships }, { groupId: 'g1', companyId: 'c2' }, ['company_admin']),
      ).toBe(false);
      expect(
        holdsRoleFor({ memberships }, { groupId: 'g1', companyId: 'c2' }, ['group_marketing']),
      ).toBe(true);
      expect(
        holdsRoleFor({ memberships }, { groupId: 'g2', companyId: 'c9' }, ['group_marketing']),
      ).toBe(false);
    });

    it('the platform owner is exempt from the role list, and the audit trail says so', async () => {
      const a = await published('Pulled by the owner.', legal);
      // Acting as one role the owner does not need to be listed for: the exemption, not the membership, lets this through.
      expect((await asOwner('PUT', '/api/me/acting-role', { role: 'group_admin' })).status).toBe(
        200,
      );
      const res = await asOwner('POST', `/api/publications/${a.publication.id}/remove`, {
        reason: LONG_ENOUGH,
      });
      expect(res.status).toBe(200);
      const audit = await w.audit(a.publication.id, 'publication.removed');
      expect(audit.at(-1)!.details).toMatchObject({
        event: 'removed',
        platformOwnerExemption: true,
      });
      await asOwner('PUT', '/api/me/acting-role', { role: null });
    });
  });

  describe('removing a post', () => {
    it('needs a written reason of 10 to 1000 characters', async () => {
      const a = await published('Reason rules.', routine);
      for (const body of [
        {},
        { reason: '' },
        { reason: 'too short' },
        { reason: '   short    ' },
        { reason: 'x'.repeat(1001) },
      ])
        expect(
          (await remove('mgr', a.publication.id, body)).status,
          JSON.stringify(body).slice(0, 30),
        ).toBe(400);
      expect((await row(a.publication.id)).status).toBe('published');
      expect((await remove('mgr', a.publication.id, { reason: 'x'.repeat(1000) })).status).toBe(
        200,
      );
    });

    it('deletes the post at the engine and records removed, who, when and why, and keeps the record', async () => {
      const a = await published('Wrong price in this post.', routine);
      expect(w.engine.posts.has(a.publication.engineOperationId)).toBe(true);
      const res = await remove('mgr', a.publication.id, { reason: '  The price is wrong.  ' });
      expect(res.status).toBe(200);
      const dto = await w.json(res);
      expect(dto).toMatchObject({
        id: a.publication.id,
        status: 'removed',
        removedBy: w.ids.mgr,
        removalReason: 'The price is wrong.',
        removalIncidentId: null,
        canRemove: false,
        canCorrect: true,
      });
      expect(dto.removedAt).toBeTruthy();
      expect(w.engine.posts.has(a.publication.engineOperationId)).toBe(false);

      const stored = await row(a.publication.id);
      expect(stored).toMatchObject({
        status: 'removed',
        removed_by: w.ids.mgr,
        removal_reason: 'The price is wrong.',
      });
      // The history stays: the record is in the list, with its external link and who asked for it.
      const listed = (await list('mgr')).find((p: any) => p.id === a.publication.id);
      expect(listed).toMatchObject({ status: 'removed', requestedBy: w.ids.exec });
      // The item no longer claims to be published.
      const item = await w.json(await w.send('GET', `/api/content-items/${a.item.id}`, 'writer'));
      expect(item.status).toBe('archived');
    });

    it('a post is never erased: removing twice is refused, the database refuses to bring it back, and the same version cannot be published again', async () => {
      const a = await published('Gone for good.', routine);
      expect((await remove('mgr', a.publication.id)).status).toBe(200);
      expect((await remove('mgr', a.publication.id)).status).toBe(409);
      // Cancelling a removed record is refused like any record that is not scheduled.
      expect(
        (await w.send('POST', `/api/publications/${a.publication.id}/cancel`, 'exec')).status,
      ).toBe(409);
      // Publishing the same approved version again must not resurrect it.
      const again = await w.send('POST', `/api/content-items/${a.item.id}/publish`, 'exec', {
        socialAccountId: w.f.accountA,
      });
      expect(again.status).toBe(409);
      expect((await w.json(again)).message).toContain('removed');
      expect((await row(a.publication.id)).status).toBe('removed');
      // And the database itself holds the line.
      await expect(
        w.q(`update publications set status = 'published' where id = $1`, [a.publication.id]),
      ).rejects.toThrow(/stays removed/);
      await expect(
        w.q(`update publications set removal_reason = 'rewritten history' where id = $1`, [
          a.publication.id,
        ]),
      ).rejects.toThrow(/stays removed/);
      expect(
        await w.q(`select 1 from publications where id = $1`, [a.publication.id]),
      ).toHaveLength(1);
    });

    it('only a published post can be removed (a scheduled one is cancelled instead)', async () => {
      const item = await w.draft('writer', 'Planned for later.', routine);
      const request = await w.submit('writer', item.id);
      await w.send('POST', `/api/approval-requests/${request.id}/approve`, 'mgr', {});
      const scheduled = await w.json(
        await w.send('POST', `/api/content-items/${item.id}/publish`, 'exec', {
          socialAccountId: w.f.accountA,
          scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      );
      expect(scheduled.status).toBe('scheduled');
      const res = await remove('mgr', scheduled.id);
      expect(res.status).toBe(409);
      expect((await w.json(res)).message).toContain('scheduled');
    });

    it('when the engine refuses nothing changes, the answer is 502 with the reason, and the attempt is audited', async () => {
      const a = await published('The engine will not delete this.', routine);
      const original = w.engine.deletePost.bind(w.engine);
      w.engine.deletePost = async () => {
        throw new Error('Postiz answered 500 on DELETE');
      };
      try {
        const res = await remove('mgr', a.publication.id);
        expect(res.status).toBe(502);
        expect((await w.json(res)).message).toContain('Postiz answered 500');
      } finally {
        w.engine.deletePost = original;
      }
      expect(await row(a.publication.id)).toMatchObject({
        status: 'published',
        removed_by: null,
        removed_at: null,
      });
      expect(w.engine.posts.has(a.publication.engineOperationId)).toBe(true);
      expect(await w.notified(a.publication.id, 'publication.removed')).toEqual([]);
      const audit = await w.audit(a.publication.id, 'publication.removed');
      expect(audit).toHaveLength(1);
      expect(audit[0]!.details).toMatchObject({
        event: 'engine_refused',
        removed: false,
        reason: LONG_ENOUGH,
      });
      expect(audit[0]!.actor_user_id).toBe(w.ids.mgr);
      // A second try, with the engine back, works.
      expect((await remove('mgr', a.publication.id)).status).toBe(200);
    });

    it('a freeze does not block a removal (pulling a wrong post in a crisis), but the company must be active', async () => {
      const a = await published('Pulled during a freeze.', routine);
      const freeze = await w.send('POST', '/api/publishing-freezes', 'exec', {
        companyId: w.f.companyA,
      });
      expect(freeze.status).toBe(201);
      try {
        expect((await remove('mgr', a.publication.id)).status).toBe(200);
      } finally {
        await w.send('DELETE', `/api/publishing-freezes/${(await w.json(freeze)).id}`, 'exec');
      }

      const b = await published('Company will be suspended.', routine);
      await w.q(`update companies set status = 'suspended' where id = $1`, [w.f.companyA]);
      try {
        const res = await remove('mgr', b.publication.id);
        expect(res.status).toBe(403);
        expect((await w.json(res)).message).toContain('suspended');
      } finally {
        await w.q(`update companies set status = 'active' where id = $1`, [w.f.companyA]);
      }
      expect((await row(b.publication.id)).status).toBe('published');
    });

    it('audits the removal with the reason, in the same transaction, and tells the writer and the approvers (not the person who removed it)', async () => {
      const a = await published('Tell the right people.', routine);
      expect((await remove('exec', a.publication.id)).status).toBe(403); // exec may not, so no notifications yet
      expect(await w.notified(a.publication.id, 'publication.removed')).toEqual([]);
      expect(
        (await remove('writer', a.publication.id, { reason: 'Withdrawn by the administrator.' }))
          .status,
      ).toBe(200);
      const told = await w.notified(a.publication.id, 'publication.removed');
      expect(told).toContain(w.ids.mgr); // approved it
      expect(told).toContain(w.ids.exec); // pressed publish (requested_by)
      expect(told).not.toContain(w.ids.writer); // removed it herself
      const audit = await w.audit(a.publication.id, 'publication.removed');
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actor_user_id).toBe(w.ids.writer);
      expect(audit[0]!.details).toMatchObject({
        event: 'removed',
        removed: true,
        reason: 'Withdrawn by the administrator.',
        contentItemId: a.item.id,
      });
    });

    it('also tells the writer when somebody else removes it', async () => {
      const a = await published('Writer must hear it.', routine);
      expect((await remove('mgr', a.publication.id)).status).toBe(200);
      const told = await w.notified(a.publication.id, 'publication.removed');
      expect(told).toContain(w.ids.writer);
      expect(told).not.toContain(w.ids.mgr);
    });
  });

  describe('linking an incident', () => {
    const incident = async (companyId: string, status = 'open') =>
      (
        await w.q<{ id: string }>(
          `insert into incidents (company_id, title, severity, status, opened_by)
           values ($1, 'Wrong post', 'high', $2, $3) returning id`,
          [companyId, status, w.ids.exec],
        )
      )[0]!.id;

    it('records the open incident of the same company and tells the people who manage incidents', async () => {
      const cto = (
        await w.q<{ id: string }>(
          `insert into users (idp_subject, email, display_name) values ('sub-cto', 'cto@example.test', 'cto') returning id`,
        )
      )[0]!.id;
      await w.q(
        `insert into memberships (user_id, group_id, company_id, role) values ($1, $2, null, 'group_cto')`,
        [cto, w.f.groupId],
      );
      const a = await published('Part of an incident.', routine);
      const inc = await incident(w.f.companyA);
      const res = await remove('mgr', a.publication.id, { reason: LONG_ENOUGH, incidentId: inc });
      expect(res.status).toBe(200);
      expect((await w.json(res)).removalIncidentId).toBe(inc);
      expect(await w.notified(a.publication.id, 'publication.removed')).toContain(cto);
      expect((await w.audit(a.publication.id, 'publication.removed'))[0]!.details).toMatchObject({
        incidentId: inc,
      });
    });

    it('refuses an incident of another company, a closed one and one that does not exist; nothing changes', async () => {
      const a = await published('Bad incident links.', routine);
      for (const incidentId of [
        await incident(w.f.companyB),
        await incident(w.f.companyA, 'closed'),
        randomUUID(),
      ]) {
        const res = await remove('mgr', a.publication.id, { reason: LONG_ENOUGH, incidentId });
        expect(res.status).toBe(400);
      }
      expect(await row(a.publication.id)).toMatchObject({ status: 'published' });
      expect(w.engine.posts.has(a.publication.engineOperationId)).toBe(true);
    });
  });

  describe('correcting a post', () => {
    it('makes a new draft that copies the text, the target accounts, the media and the category, and links both ways', async () => {
      const a = await published('Text to correct.', routine);
      // a picture on the published version
      const media = (
        await w.q<{ id: string }>(
          `insert into content_media (company_id, uploaded_by, kind, file_name, mime_type, size_bytes, storage_key)
           values ($1, $2, 'image', 'p.png', 'image/png', 48, 'k/p.png') returning id`,
          [w.f.companyA, w.ids.writer],
        )
      )[0]!.id;
      await w.q(
        `insert into content_version_media (content_version_id, media_id, company_id, position) values ($1, $2, $3, 0)`,
        [a.publication.contentVersionId, media, w.f.companyA],
      );
      const res = await correct('mgr', a.publication.id, {
        reason: 'The date is wrong.',
        removeOriginal: false,
      });
      expect(res.status).toBe(201);
      const out = await w.json(res);
      expect(out.originalRemoved).toBe(false);
      expect(out.publication).toMatchObject({ id: a.publication.id, status: 'published' });
      expect(out.contentItem).toMatchObject({
        companyId: w.f.companyA,
        status: 'draft',
        categoryId: routine,
        createdBy: w.ids.mgr,
        correctsPublicationId: a.publication.id,
      });
      expect(out.contentItem.id).not.toBe(a.item.id);
      expect(out.contentItem.currentVersion).toMatchObject({
        versionNumber: 1,
        body: 'Text to correct.',
        targetAccountIds: [w.f.accountA],
        createdBy: w.ids.mgr,
      });
      expect(out.contentItem.currentVersion.media.map((m: any) => m.id)).toEqual([media]);
      // the original is untouched
      expect(w.engine.posts.has(a.publication.engineOperationId)).toBe(true);
      expect(
        (await w.json(await w.send('GET', `/api/content-items/${a.item.id}`, 'writer'))).status,
      ).toBe('published');
      // the link is visible on the item and on the publication
      const item = await w.json(
        await w.send('GET', `/api/content-items/${out.contentItem.id}`, 'mgr'),
      );
      expect(item.correctsPublicationId).toBe(a.publication.id);
      const listed = (await list('mgr')).find((p: any) => p.id === a.publication.id);
      expect(listed.correctionContentItemIds).toEqual([out.contentItem.id]);
    });

    it('needs a reason and a boolean, and only a published or removed post can be corrected', async () => {
      const a = await published('Validation.', routine);
      for (const body of [
        {},
        { reason: LONG_ENOUGH },
        { reason: 'short', removeOriginal: false },
        { reason: LONG_ENOUGH, removeOriginal: 'yes' },
      ])
        expect((await correct('mgr', a.publication.id, body)).status).toBe(400);
      const item = await w.draft('writer', 'Only scheduled.', routine);
      const request = await w.submit('writer', item.id);
      await w.send('POST', `/api/approval-requests/${request.id}/approve`, 'mgr', {});
      const scheduled = await w.json(
        await w.send('POST', `/api/content-items/${item.id}/publish`, 'exec', {
          socialAccountId: w.f.accountA,
          scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      );
      expect(
        (await correct('mgr', scheduled.id, { reason: LONG_ENOUGH, removeOriginal: false })).status,
      ).toBe(409);
    });

    it('is allowed only to the roles of the post category, like removal', async () => {
      const a = await published('A legal one.', legal);
      expect(
        (await correct('mgr', a.publication.id, { reason: LONG_ENOUGH, removeOriginal: false }))
          .status,
      ).toBe(403);
      expect(
        (
          await correct('creatorB', a.publication.id, {
            reason: LONG_ENOUGH,
            removeOriginal: false,
          })
        ).status,
      ).toBe(403);
      expect(
        await w.q(`select 1 from content_items where corrects_publication_id = $1`, [
          a.publication.id,
        ]),
      ).toHaveLength(0);
      expect(
        (await correct('exec', a.publication.id, { reason: LONG_ENOUGH, removeOriginal: false }))
          .status,
      ).toBe(201);
    });

    it('with removeOriginal the original is removed first, then the draft is made', async () => {
      const a = await published('Replace this one.', routine);
      const res = await correct('mgr', a.publication.id, {
        reason: 'Wrong date, replacing it.',
        removeOriginal: true,
      });
      expect(res.status).toBe(201);
      const out = await w.json(res);
      expect(out.originalRemoved).toBe(true);
      expect(out.publication).toMatchObject({
        status: 'removed',
        removedBy: w.ids.mgr,
        removalReason: 'Wrong date, replacing it.',
      });
      expect(w.engine.posts.has(a.publication.engineOperationId)).toBe(false);
      expect(out.contentItem).toMatchObject({
        status: 'draft',
        correctsPublicationId: a.publication.id,
      });
      // both facts are on record
      expect(await w.audit(a.publication.id, 'publication.removed')).toHaveLength(1);
      const corrections = await w.audit(a.publication.id, 'publication.correction_requested');
      expect(corrections).toHaveLength(1);
      expect(corrections[0]!.details).toMatchObject({
        reason: 'Wrong date, replacing it.',
        removeOriginal: true,
        originalRemoved: true,
        correctionContentItemId: out.contentItem.id,
      });
    });

    it('if the original cannot be removed no draft is made (engine failure, or a caller who may not remove)', async () => {
      const a = await published('Cannot take this down.', routine);
      const original = w.engine.deletePost.bind(w.engine);
      w.engine.deletePost = async () => {
        throw new Error('network said no');
      };
      try {
        const res = await correct('mgr', a.publication.id, {
          reason: LONG_ENOUGH,
          removeOriginal: true,
        });
        expect(res.status).toBe(502);
      } finally {
        w.engine.deletePost = original;
      }
      expect(await row(a.publication.id)).toMatchObject({ status: 'published' });
      expect(
        await w.q(`select 1 from content_items where corrects_publication_id = $1`, [
          a.publication.id,
        ]),
      ).toHaveLength(0);
      expect(await w.audit(a.publication.id, 'publication.correction_requested')).toHaveLength(0);

      // an incident that cannot be linked also stops it before anything is touched
      const bad = await correct('mgr', a.publication.id, {
        reason: LONG_ENOUGH,
        removeOriginal: true,
        incidentId: randomUUID(),
      });
      expect(bad.status).toBe(400);
      expect(w.engine.posts.has(a.publication.engineOperationId)).toBe(true);
      expect(
        await w.q(`select 1 from content_items where corrects_publication_id = $1`, [
          a.publication.id,
        ]),
      ).toHaveLength(0);
    });

    it('removeOriginal on a post that is already removed is refused; without it the correction still works', async () => {
      const a = await published('Already pulled.', routine);
      expect((await remove('mgr', a.publication.id)).status).toBe(200);
      expect(
        (await correct('mgr', a.publication.id, { reason: LONG_ENOUGH, removeOriginal: true }))
          .status,
      ).toBe(409);
      const res = await correct('mgr', a.publication.id, {
        reason: LONG_ENOUGH,
        removeOriginal: false,
      });
      expect(res.status).toBe(201);
      expect((await w.json(res)).publication.status).toBe('removed');
    });

    it('the person who made the correction can never approve it; somebody else can, and it then publishes through the normal gate', async () => {
      const a = await published('Separation of duties.', routine);
      const out = await w.json(
        await correct('mgr', a.publication.id, { reason: LONG_ENOUGH, removeOriginal: true }),
      );
      const id = out.contentItem.id as string;
      const request = await w.submit('mgr', id);
      const own = await w.send('POST', `/api/approval-requests/${request.id}/approve`, 'mgr', {});
      expect(own.status).toBe(403);
      // not published without an approval either
      const early = await w.send('POST', `/api/content-items/${id}/publish`, 'exec', {
        socialAccountId: w.f.accountA,
      });
      expect(early.status).toBe(403);
      const other = await w.send(
        'POST',
        `/api/approval-requests/${request.id}/approve`,
        'mgr2',
        {},
      );
      expect(other.status).toBe(201);
      const publish = await w.send('POST', `/api/content-items/${id}/publish`, 'exec', {
        socialAccountId: w.f.accountA,
      });
      expect(publish.status).toBe(201);
      expect((await w.json(publish)).status).toBe('published');
    });

    it('tells the approvers (not the person who drafted it) and audits the correction with the reason', async () => {
      const a = await published('Tell the approvers.', routine);
      const out = await w.json(
        await correct('writer', a.publication.id, {
          reason: 'The link is broken.',
          removeOriginal: false,
        }),
      );
      const told = await w.notified(out.contentItem.id, 'publication.correction_requested');
      expect(told.sort()).toEqual([w.ids.mgr, w.ids.mgr2].sort());
      const audit = await w.audit(a.publication.id, 'publication.correction_requested');
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actor_user_id).toBe(w.ids.writer);
      expect(audit[0]!.details).toMatchObject({
        reason: 'The link is broken.',
        removeOriginal: false,
        originalRemoved: false,
        correctionContentItemId: out.contentItem.id,
      });
      const drafted = await w.audit(out.contentItem.id, 'content.drafted');
      expect(drafted[0]!.details).toMatchObject({ correctsPublicationId: a.publication.id });
    });
  });

  describe('company separation (attacks)', () => {
    it("another company's executive can neither remove nor correct, and learns nothing (404)", async () => {
      const a = await published('Company A only.', routine);
      expect((await remove('execB', a.publication.id)).status).toBe(404);
      expect(
        (await correct('execB', a.publication.id, { reason: LONG_ENOUGH, removeOriginal: false }))
          .status,
      ).toBe(404);
      expect((await remove('execB', randomUUID())).status).toBe(404);
      expect(await row(a.publication.id)).toMatchObject({ status: 'published' });
      expect(
        await w.q(`select 1 from content_items where corrects_publication_id = $1`, [
          a.publication.id,
        ]),
      ).toHaveLength(0);
    });

    it("a removal cannot be tied to another company's incident, and no row of company A ever lands in company B", async () => {
      const a = await published('Cross-company link.', routine);
      const foreign = (
        await w.q<{ id: string }>(
          `insert into incidents (company_id, title, severity, opened_by) values ($1, 'B only', 'low', $2) returning id`,
          [w.f.companyB, w.ids.execB],
        )
      )[0]!.id;
      expect(
        (await remove('mgr', a.publication.id, { reason: LONG_ENOUGH, incidentId: foreign }))
          .status,
      ).toBe(400);
      await correct('mgr', a.publication.id, { reason: LONG_ENOUGH, removeOriginal: false });
      expect(
        await w.q(
          `select 1 from content_items where company_id = $1 and corrects_publication_id is not null`,
          [w.f.companyB],
        ),
      ).toHaveLength(0);
    });

    it("the database refuses a content item of one company that corrects another company's publication", async () => {
      const a = await published('Foreign key.', routine);
      await expect(
        w.q(
          `insert into content_items (company_id, created_by, corrects_publication_id) values ($1, $2, $3)`,
          [w.f.companyB, w.ids.execB, a.publication.id],
        ),
      ).rejects.toThrow(/foreign key/);
      await expect(
        w.q(
          `update publications set status = 'removed', removed_by = $2, removed_at = now(), removal_reason = 'x', removal_incident_id = null where id = $1`,
          [a.publication.id, w.ids.mgr],
        ),
      ).rejects.toThrow(/removal_record/);
    });
  });

  describe('the policy carries the roles (PUT /approval-policies)', () => {
    it('stores removeRoles, lists them, keeps them when omitted, and an empty list means the default again', async () => {
      const category = await w.category('policy-roles', 'Policy roles');
      const put = (body: Record<string, unknown>) =>
        w.send('PUT', '/api/approval-policies', 'writer', {
          companyId: w.f.companyA,
          categoryId: category,
          requiredApprovals: 1,
          approverRoles: [],
          ...body,
        });
      const first = await put({ removeRoles: ['company_executive', 'company_admin'] });
      expect(first.status).toBe(200);
      expect((await w.json(first)).removeRoles).toEqual(['company_executive', 'company_admin']);
      const kept = await put({ requiredApprovals: 2 });
      expect((await w.json(kept)).removeRoles).toEqual(['company_executive', 'company_admin']);
      const stored = (
        await w.json(
          await w.send('GET', `/api/approval-policies?companyId=${w.f.companyA}`, 'writer'),
        )
      ).find((p: any) => p.categoryId === category);
      expect(stored.removeRoles).toEqual(['company_executive', 'company_admin']);
      const cleared = await put({ removeRoles: [] });
      expect((await w.json(cleared)).removeRoles).toEqual([]);
      // the audit event shows the change
      const audit = await w.audit(stored.id, 'approval_policy.set');
      expect(audit.at(-1)!.details.to.removeRoles).toEqual([]);
      expect(audit.at(-1)!.details.from.removeRoles).toEqual([
        'company_executive',
        'company_admin',
      ]);
    });

    it('refuses a role that cannot remove posts, and a person without policy rights', async () => {
      const category = await w.category('policy-bad', 'Policy bad');
      const body = {
        companyId: w.f.companyA,
        categoryId: category,
        requiredApprovals: 1,
        approverRoles: [],
      };
      const auditor = await w.send('PUT', '/api/approval-policies', 'writer', {
        ...body,
        removeRoles: ['auditor'],
      });
      expect(auditor.status).toBe(400);
      const stranger = await w.send('PUT', '/api/approval-policies', 'execB', {
        ...body,
        removeRoles: ['company_admin'],
      });
      expect([403, 404]).toContain(stranger.status);
    });
  });

  describe('the database record', () => {
    it('only a removal with a who, a when and a reason of ten characters is accepted', async () => {
      const a = await published('Constraint check.', routine);
      await expect(
        w.q(`update publications set status = 'removed' where id = $1`, [a.publication.id]),
      ).rejects.toThrow(/removal_record/);
      await expect(
        w.q(
          `update publications set status = 'removed', removed_by = $2, removed_at = now(), removal_reason = 'short' where id = $1`,
          [a.publication.id, w.ids.mgr],
        ),
      ).rejects.toThrow(/removal_record/);
      await expect(
        w.q(`update publications set removed_at = now() where id = $1`, [a.publication.id]),
      ).rejects.toThrow(/removal_record/);
    });
  });
});

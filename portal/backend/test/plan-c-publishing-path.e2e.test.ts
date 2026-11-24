import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlanHarness } from './plan-harness';

/**
 * docs/testing/INTEGRATION-TEST-PLAN.md section C (tests 18 to 25): the publishing path end to end, over HTTP,
 * against the real database and the fake engine. Test numbers are the plan's.
 */
describe('integration plan C: the publishing path', () => {
  const h = new PlanHarness();
  let g!: { groupId: string; companyA: string; accountA: string };
  const { send, json } = h;

  beforeAll(async () => {
    await h.start();
    g = { groupId: h.f.groupId, companyA: h.f.companyA, accountA: h.f.accountA };
    const inA = (role: string) => [{ role, companyId: g.companyA, groupId: g.groupId }];
    await h.persona('creator', inA('content_creator'));
    await h.persona('creator2', inA('content_creator'));
    await h.persona('manager', inA('company_marketing_manager'));
    await h.persona('manager2', inA('company_marketing_manager'));
    await h.persona('publisher', inA('publisher'));
    await h.persona('executive', inA('company_executive'));
    await h.persona('admin', inA('company_admin'));
    // A group-level reviewer: works for the whole group, not for one company.
    await h.persona('groupReviewer', [
      { role: 'group_marketing', companyId: null, groupId: g.groupId },
    ]);
  });
  afterAll(async () => {
    await h.stop();
  });

  const draft = async (text: string, who = 'creator') =>
    json(
      await send('POST', '/api/content-items', who, {
        companyId: g.companyA,
        body: text,
        targetAccountIds: [g.accountA],
      }),
    );
  const submit = async (itemId: string, who = 'creator') =>
    json(await send('POST', `/api/content-items/${itemId}/submit`, who));
  const approve = (requestId: string, who = 'manager') =>
    send('POST', `/api/approval-requests/${requestId}/approve`, who, {});
  const publish = (itemId: string, who = 'publisher') =>
    send('POST', `/api/content-items/${itemId}/publish`, who, { socialAccountId: g.accountA });
  const approved = (text: string) =>
    h.approvedItem({
      text,
      author: 'creator',
      approver: 'manager',
      companyId: g.companyA,
      accountId: g.accountA,
    });
  const rows = (sql: string, values: unknown[] = []) => h.query(sql, values);

  it('C18: draft, submit, a different person approves, a publisher publishes: one publication, published, audited in order', async () => {
    const item = await draft('Test 18: the whole path.');
    const request = await submit(item.id);
    expect((await approve(request.id)).status).toBe(201);
    const before = h.fake.published.length;

    const response = await publish(item.id);

    expect(response.status).toBe(201);
    const publication = await json(response);
    expect(publication).toMatchObject({
      contentItemId: item.id,
      status: 'published',
      approvedBy: h.userIds.get('manager'),
      requestedBy: h.userIds.get('publisher'),
    });
    expect(h.fake.published).toHaveLength(before + 1);
    expect(
      await rows(`select count(*)::int as n from publications where content_item_id = $1`, [
        item.id,
      ]),
    ).toEqual([{ n: 1 }]);
    expect((await json(await send('GET', `/api/content-items/${item.id}`, 'creator'))).status).toBe(
      'published',
    );
    const events = await rows(
      `select action from audit_events where target_id = any($1::text[]) order by id`,
      [[item.id, request.id, publication.id]],
    );
    expect(events.map((e) => e.action)).toEqual([
      'content.drafted',
      'content.submitted',
      'content.approved',
      'publication.published',
    ]);
  });

  it('C19: the creator cannot approve their own item', async () => {
    // A marketing manager may write and approve, but never on their own item.
    const item = await draft('Test 19: my own post.', 'manager');
    const request = await submit(item.id, 'manager');

    const response = await approve(request.id, 'manager');

    expect(response.status).toBe(403);
    const body = await json(response);
    expect(body.message).toMatch(/./);
    expect(body.requestId).toBeTruthy();
    expect((await json(await send('GET', `/api/content-items/${item.id}`, 'manager'))).status).toBe(
      'in_review',
    );
    expect(
      await rows(
        `select 1 from approval_decisions d join approval_requests r on r.id = d.approval_request_id where r.id = $1 and d.decision = 'approved'`,
        [request.id],
      ),
    ).toHaveLength(0);
  });

  it('C20: a second person who rewrites the text cannot approve it, and neither can the first author', async () => {
    const item = await draft('Test 20: first text.');
    const edited = await send('PATCH', `/api/content-items/${item.id}`, 'manager2', {
      body: 'Test 20: second text, by someone else.',
    });
    expect(edited.status).toBe(200);
    const request = await submit(item.id, 'manager2');

    expect((await approve(request.id, 'manager2')).status).toBe(403); // wrote version 2
    expect((await approve(request.id, 'manager')).status).toBe(201); // wrote nothing
    // The first author, with the power to approve, is refused on the second author's request too.
    const other = await draft('Test 20b: first text.', 'manager');
    await send('PATCH', `/api/content-items/${other.id}`, 'manager2', {
      body: 'Test 20b: rewritten.',
    });
    const otherRequest = await submit(other.id, 'manager2');
    expect((await approve(otherRequest.id, 'manager')).status).toBe(403); // wrote version 1
    expect((await approve(otherRequest.id, 'executive')).status).toBe(201);
  });

  it('C21: approve, then edit the text, then publish without a new approval: refused, the item is a draft again', async () => {
    const { item } = await approved('Test 21: approved text.');
    const edit = await send('PATCH', `/api/content-items/${item.id}`, 'creator', {
      body: 'Test 21: changed after approval.',
    });
    expect(edit.status).toBe(200);
    expect((await json(await send('GET', `/api/content-items/${item.id}`, 'creator'))).status).toBe(
      'draft',
    );
    const before = h.fake.published.length;

    const response = await publish(item.id);

    expect(response.status).toBe(403);
    expect(h.fake.published).toHaveLength(before);
    expect(
      await rows(`select 1 from publications where content_item_id = $1`, [item.id]),
    ).toHaveLength(0);
  });

  it('C22: pressing publish twice quickly makes one publication and one call to the engine', async () => {
    const { item } = await approved('Test 22: double click.');
    const before = h.fake.published.length;

    const [one, two] = await Promise.all([publish(item.id), publish(item.id)]);

    // One of them may be told "already in progress" (409) or both get the same record: never two sends.
    expect([one.status, two.status].every((s) => s === 201 || s === 409)).toBe(true);
    expect([one.status, two.status]).toContain(201);
    expect(h.fake.published).toHaveLength(before + 1);
    expect(
      await rows(`select count(*)::int as n from publications where content_item_id = $1`, [
        item.id,
      ]),
    ).toEqual([{ n: 1 }]);
    // And once finished, a third press returns the same record without a call.
    const third = await json(await publish(item.id));
    expect(third.status).toBe('published');
    expect(h.fake.published).toHaveLength(before + 1);
  });

  it('C23: a frozen company cannot publish; after the freeze is lifted it can; lifting asks for a recent sign-in', async () => {
    const { item } = await approved('Test 23: freeze.');
    const freeze = await send('POST', '/api/publishing-freezes', 'executive', {
      companyId: g.companyA,
      reason: 'Test 23',
    });
    expect(freeze.status).toBe(201);
    const freezeRow = await json(freeze);
    const before = h.fake.published.length;

    expect((await publish(item.id)).status).toBe(403);
    expect(h.fake.published).toHaveLength(before);

    // With an old sign-in the freeze stays: the API asks the person to sign in again.
    const stale = await h.staleSession('executive', 20);
    const refused = await send('DELETE', `/api/publishing-freezes/${freezeRow.id}`, stale);
    expect(refused.status).toBe(401);
    expect(await json(refused)).toMatchObject({ code: 'reauth_required' });
    expect((await publish(item.id)).status).toBe(403);

    expect(
      (await send('DELETE', `/api/publishing-freezes/${freezeRow.id}`, 'executive')).status,
    ).toBe(204);
    const after = await publish(item.id);
    expect(after.status).toBe(201);
    expect(h.fake.published).toHaveLength(before + 1);
    expect(
      (
        await rows(`select action from audit_events where action like 'publishing.%' order by id`)
      ).map((e) => e.action),
    ).toEqual(['publishing.frozen', 'publishing.unfrozen']);
  });

  it('C24: an archived account cannot be published to, even for an item approved for it', async () => {
    const { item } = await approved('Test 24: archived account.');
    expect(
      (
        await send('PATCH', `/api/social-accounts/${g.accountA}/status`, 'admin', {
          status: 'archived',
        })
      ).status,
    ).toBe(200);
    const before = h.fake.published.length;

    const response = await publish(item.id);

    expect(response.status).toBe(403);
    expect(h.fake.published).toHaveLength(before);
    // Put it back so the notification test below is not affected.
    expect(
      (
        await send('PATCH', `/api/social-accounts/${g.accountA}/status`, 'admin', {
          status: 'active',
        })
      ).status,
    ).toBe(200);
    expect((await publish(item.id)).status).toBe(201);
  });

  it('C25: a group-level reviewer is notified when a company creator submits', async () => {
    const item = await draft('Test 25: notify the group.');
    const request = await submit(item.id);

    const notifications = await json(await send('GET', '/api/notifications', 'groupReviewer'));

    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'content.submitted',
          targetId: item.id,
          readAt: null,
        }),
      ]),
    );
    // It is the reviewer's own notification: the creator who submitted does not get one for their own submit.
    const own = await json(await send('GET', '/api/notifications', 'creator'));
    expect(
      own.some((n: any) => n.targetId === item.id && n.eventType === 'content.submitted'),
    ).toBe(false);
    expect(request.id).toBeTruthy();
  });
});

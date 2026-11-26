import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './replies-harness';

/**
 * Round 2, E-14 (RQ-033): moderation. Hide: Content Writer and Digital Marketing Manager. Delete and block: the Digital
 * Marketing Manager only, with a written reason. Every action is recorded and audited; an engine without the capability
 * gives `recorded_only` and says so; another company's people cannot touch company A.
 */
describe('moderation of comments (E-14)', () => {
  let h: Harness;
  let n = 0;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.stop();
  });

  const fresh = (channel = 'fake-linkedin-1') => {
    n += 1;
    const id = `msg-m-${n}`;
    h.addMessage(id, { channel, author: `Spammer ${n}` });
    return id;
  };
  const act = (
    who: string,
    action: 'hide' | 'delete' | 'block',
    engineMessageId: string,
    reason?: string,
    account = h.f.accountA,
  ) =>
    h.send('POST', `/api/inbox/moderation/${action}`, who, {
      socialAccountId: account,
      engineMessageId,
      ...(reason === undefined ? {} : { reason }),
    });
  const recorded = async (engineMessageId: string) =>
    h.query(
      `select * from inbox_moderation_actions where engine_message_id = $1 order by performed_at`,
      [engineMessageId],
    );

  it('the Content Writer and the Digital Marketing Manager hide a comment; a reason is optional', async () => {
    const a = fresh();
    const r = await act('writerA', 'hide', a);
    expect(r.status).toBe(201);
    expect(await h.json(r)).toMatchObject({
      action: 'hide',
      outcome: 'done',
      reason: null,
      performedBy: h.people.writerA,
      outcomeNote: 'The comment was hidden in the network.',
    });
    expect(h.fake.hidden.has(a)).toBe(true);
    const b = fresh();
    expect((await act('mgrA', 'hide', b, 'Rude, not abusive.')).status).toBe(201);
    expect((await recorded(b))[0]).toMatchObject({ reason: 'Rude, not abusive.', outcome: 'done' });
    const audit = await h.query(
      `select action, actor_user_id from audit_events where details->>'engineMessageId' = $1`,
      [a],
    );
    expect(audit).toEqual([{ action: 'inbox.moderated', actor_user_id: h.people.writerA }]);
  });

  it('the Content Writer cannot delete or block; nobody else without the permission can hide', async () => {
    const a = fresh();
    expect((await act('writerA', 'delete', a, 'It is spam, clearly.')).status).toBe(403);
    expect((await act('writerA', 'block', a, 'It is spam, clearly.')).status).toBe(403);
    expect((await act('execA', 'hide', a)).status).toBe(403); // senior management reads and manages, but does not moderate
    expect((await act('adminA', 'hide', a)).status).toBe(403);
    expect((await act('execA', 'delete', a, 'It is spam, clearly.')).status).toBe(403);
    expect(await recorded(a)).toHaveLength(0);
    expect(h.fake.inboxMessages.some((m) => m.engineMessageId === a)).toBe(true);
  });

  it('the Digital Marketing Manager deletes a comment and blocks a person, with a written reason', async () => {
    const a = fresh();
    const del = await act('mgrA', 'delete', a, 'Abusive language.');
    expect(del.status).toBe(201);
    expect(await h.json(del)).toMatchObject({
      action: 'delete',
      outcome: 'done',
      reason: 'Abusive language.',
    });
    expect(h.fake.inboxMessages.some((m) => m.engineMessageId === a)).toBe(false);

    const b = fresh();
    const author = h.fake.inboxMessages.find((m) => m.engineMessageId === b)!.authorName;
    const blocked = await act('mgrA', 'block', b, 'Repeated harassment.');
    expect(blocked.status).toBe(201);
    expect(h.fake.blocked.has(author)).toBe(true);
    expect(h.fake.moderated.map((m) => m.action)).toEqual(
      expect.arrayContaining(['delete', 'block']),
    );
  });

  it('delete and block refuse without a reason (nothing is recorded or changed)', async () => {
    const a = fresh();
    expect((await act('mgrA', 'delete', a)).status).toBe(400);
    expect((await act('mgrA', 'delete', a, '  ')).status).toBe(400);
    expect((await act('mgrA', 'block', a, 'no')).status).toBe(400);
    expect(await recorded(a)).toHaveLength(0);
    expect(h.fake.inboxMessages.some((m) => m.engineMessageId === a)).toBe(true);
  });

  it('an engine without the capability: the action is recorded as recorded_only and the person is told plainly', async () => {
    const a = fresh();
    const original = h.fake.hideMessage;
    (h.fake as any).hideMessage = undefined; // this engine cannot hide
    try {
      const r = await act('mgrA', 'hide', a);
      expect(r.status).toBe(201);
      const body = await h.json(r);
      expect(body.outcome).toBe('recorded_only');
      expect(body.outcomeNote).toBe(
        "Recorded, but the network was not changed. Hide it in the network's own inbox.",
      );
    } finally {
      h.fake.hideMessage = original;
    }
    expect(h.fake.hidden.has(a)).toBe(false);
    expect((await recorded(a))[0]).toMatchObject({
      outcome: 'recorded_only',
      performed_by: h.people.mgrA,
    });
    const audit = await h.query(
      `select details from audit_events where action = 'inbox.moderated' and details->>'engineMessageId' = $1`,
      [a],
    );
    expect(audit[0].details).toMatchObject({ action: 'hide', outcome: 'recorded_only' });
  });

  it('when the network refuses, the attempt is recorded as failed and the person is told nothing changed', async () => {
    const a = fresh();
    h.fake.failNextModerationWith = new Error('Network error 500');
    const r = await act('mgrA', 'delete', a, 'Abusive language.');
    expect(r.status).toBe(502);
    expect((await h.json(r)).message).toMatch(/Nothing was changed/);
    expect((await recorded(a))[0]).toMatchObject({
      outcome: 'failed',
      outcome_detail: 'Network error 500',
    });
    expect(h.fake.inboxMessages.some((m) => m.engineMessageId === a)).toBe(true);
  });

  it('the message must belong to the account: an unknown message or another account is a 404', async () => {
    const a = fresh('fake-facebook-1'); // company B's channel
    expect((await act('mgrA', 'hide', a)).status).toBe(404); // a message of B's channel, asked on A's account
    expect((await act('mgrA', 'hide', 'msg-unknown')).status).toBe(404);
  });

  it("another company's people cannot moderate company A, and the record is separate", async () => {
    const a = fresh();
    expect((await act('mgrB', 'hide', a)).status).toBe(404);
    expect((await act('mgrB', 'delete', a, 'Not even mine to remove.')).status).toBe(404);
    expect((await act('writerB', 'hide', a)).status).toBe(404);
    expect(await recorded(a)).toHaveLength(0);
    // And company A's manager cannot act on company B's account.
    const b = fresh('fake-facebook-1');
    expect((await act('mgrA', 'hide', b, undefined, h.f.accountB)).status).toBe(404);
    // Each manager lists only their own company's record.
    const bOwn = await act('mgrB', 'hide', b, undefined, h.f.accountB);
    expect(bOwn.status).toBe(201);
    const listA = await h.json(await h.send('GET', '/api/inbox/moderation', 'mgrA'));
    const listB = await h.json(await h.send('GET', '/api/inbox/moderation', 'mgrB'));
    expect(listA.length).toBeGreaterThan(0);
    expect(listA.every((x: any) => x.companyId === h.f.companyA)).toBe(true);
    expect(listB).toHaveLength(1);
    expect(listB[0]).toMatchObject({ companyId: h.f.companyB, engineMessageId: b });
    const filtered = await h.json(
      await h.send('GET', `/api/inbox/moderation?companyId=${h.f.companyA}`, 'mgrB'),
    );
    expect(filtered).toEqual([]);
  });

  it('the record is append-only for the application role (no update, no delete)', async () => {
    const { createDatabase } = await import('../src/platform/database/database');
    const { appUrl } = await import('./helpers');
    const db = createDatabase(appUrl(), 1);
    try {
      await expect(db.pool.query(`delete from inbox_moderation_actions`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.pool.query(`update inbox_moderation_actions set reason = 'x'`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.close();
    }
  });
});

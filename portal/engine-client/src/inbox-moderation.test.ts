import { describe, expect, it } from 'vitest';
import { CompositeEngine } from './composite';
import { FakeEngine } from './fake';
import { supportsModeration } from './inbox-moderation';
import { PostizEngine } from './postiz';
import type { InboxMessage } from './types';

const message = (id: string, author = 'A customer'): InboxMessage => ({
  engineMessageId: id,
  engineChannelId: 'fake-facebook-1',
  kind: 'comment',
  authorName: author,
  text: 'Text',
  receivedAt: new Date('2026-11-20T10:00:00Z'),
  engineOperationId: null,
  replied: false,
});

describe('moderation capability (E-14)', () => {
  it('the fake engine hides, deletes and blocks, and says what it did', async () => {
    const fake = new FakeEngine();
    fake.inboxMessages.push(message('m1', 'Spammer'), message('m2'));
    expect(supportsModeration(fake)).toBe(true);
    await fake.hideMessage('m1');
    await fake.blockAuthor('m1');
    await fake.deleteMessage('m2');
    expect(fake.hidden.has('m1')).toBe(true);
    expect(fake.blocked.has('Spammer')).toBe(true);
    expect(fake.inboxMessages.map((m) => m.engineMessageId)).toEqual(['m1']);
    expect(fake.moderated.map((m) => m.action)).toEqual(['hide', 'block', 'delete']);
  });

  it('refuses an unknown message and can be made to fail once', async () => {
    const fake = new FakeEngine();
    fake.inboxMessages.push(message('m1'));
    await expect(fake.hideMessage('nope')).rejects.toThrow(/No such message/);
    fake.failNextModerationWith = new Error('network said no');
    await expect(fake.hideMessage('m1')).rejects.toThrow('network said no');
    await expect(fake.hideMessage('m1')).resolves.toBeUndefined();
  });

  it('the Postiz adapter and the composite engine do not claim it', () => {
    const postiz = new PostizEngine({ baseUrl: 'https://p.example/api/public/v1', apiKey: 'K' });
    expect(supportsModeration(postiz)).toBe(false);
    expect(supportsModeration(new CompositeEngine(postiz, new FakeEngine()))).toBe(false);
    expect(supportsModeration({})).toBe(false);
  });
});

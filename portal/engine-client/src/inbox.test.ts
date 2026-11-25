import { describe, expect, it, vi } from 'vitest';
import { CompositeEngine } from './composite';
import { FakeEngine } from './fake';
import { supportsInbox } from './engine';
import { PostizEngine } from './postiz';
import {
  EngineOutcomeUnknownError,
  EngineRejectedError,
  EngineUnsupportedError,
  type InboxMessage,
} from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const range = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-30T00:00:00Z') };

const engineWith = (fetchImpl: unknown, inbox: boolean | undefined) =>
  new PostizEngine({
    baseUrl: 'https://p.example/api/public/v1',
    apiKey: 'KEY',
    inbox,
    fetchImpl: fetchImpl as never,
  });

const wire = {
  messages: [
    {
      id: 'int-1:c:cmt_1',
      integrationId: 'int-1',
      kind: 'comment',
      authorName: 'Fan',
      text: 'Open on Sunday?',
      receivedAt: '2026-11-25T09:00:00.000Z',
      networkPostId: 'post_9',
      replied: false,
    },
    {
      id: 'int-1:d:msg_2',
      integrationId: 'int-1',
      kind: 'direct_message',
      authorName: 'Abebe',
      text: 'Hello',
      receivedAt: '2026-11-25T10:00:00.000Z',
      networkPostId: null,
      replied: true,
    },
  ],
  problems: [],
};

describe('PostizEngine inbox (stubbed HTTP; the fork engine has it, stock Postiz does not)', () => {
  it('is off unless the operator says the engine has it, and then refuses clearly', async () => {
    const fetchImpl = vi.fn();
    const off = engineWith(fetchImpl, undefined);
    expect(off.capabilities().inbox).toBe(false);
    await expect(off.listInbox(range)).rejects.toBeInstanceOf(EngineUnsupportedError);
    await expect(off.replyToMessage('x:c:y', 'hi')).rejects.toBeInstanceOf(EngineUnsupportedError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(engineWith(fetchImpl, true).capabilities().inbox).toBe(true);
  });

  it('reads the inbox with the window and the channel, and maps it for DCC', async () => {
    const fetchImpl = vi.fn(async () => json(wire));
    const messages = await engineWith(fetchImpl, true).listInbox(range, 'int-1');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://p.example/api/public/v1/inbox?from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-30T00%3A00%3A00.000Z&integration=int-1',
    );
    expect((init.headers as Record<string, string>).Authorization).toBe('KEY');
    expect(messages).toEqual<InboxMessage[]>([
      {
        engineMessageId: 'int-1:c:cmt_1',
        engineChannelId: 'int-1',
        kind: 'comment',
        authorName: 'Fan',
        text: 'Open on Sunday?',
        receivedAt: new Date('2026-11-25T09:00:00.000Z'),
        engineOperationId: null,
        replied: false,
      },
      {
        engineMessageId: 'int-1:d:msg_2',
        engineChannelId: 'int-1',
        kind: 'direct_message',
        authorName: 'Abebe',
        text: 'Hello',
        receivedAt: new Date('2026-11-25T10:00:00.000Z'),
        engineOperationId: null,
        replied: true,
      },
    ]);
  });

  it('never shows a channel the engine could not read as an empty one', async () => {
    const failing = {
      messages: [],
      problems: [{ integrationId: 'int-1', reason: 'token refused' }],
    };
    await expect(
      engineWith(async () => json(failing), true).listInbox(range, 'int-1'),
    ).rejects.toBeInstanceOf(EngineOutcomeUnknownError);
    // Asking for all channels returns what could be read; the failed one is simply not in it.
    await expect(engineWith(async () => json(failing), true).listInbox(range)).resolves.toEqual([]);
  });

  it('sends a reply as a public act and reports a refusal as a definite rejection', async () => {
    const fetchImpl = vi.fn(async () => json({ replyId: 'r1' }));
    await engineWith(fetchImpl, true).replyToMessage('int-1:c:cmt_1', 'Yes, from 9');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://p.example/api/public/v1/inbox/reply');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ id: 'int-1:c:cmt_1', text: 'Yes, from 9' });
    await expect(
      engineWith(async () => json({ message: 'not allowed' }, 422), true).replyToMessage(
        'int-1:d:m',
        'x',
      ),
    ).rejects.toBeInstanceOf(EngineRejectedError);
    // A 5xx may or may not have been sent: unknown, never retried blindly.
    await expect(
      engineWith(async () => json({}, 503), true).replyToMessage('int-1:d:m', 'x'),
    ).rejects.toBeInstanceOf(EngineOutcomeUnknownError);
  });
});

describe('CompositeEngine inbox routing', () => {
  const practiceMessage: InboxMessage = {
    engineMessageId: 'practice-message-1',
    engineChannelId: 'fake-facebook-1',
    kind: 'comment',
    authorName: 'Practice fan',
    text: 'From the practice engine',
    receivedAt: new Date('2026-11-20T00:00:00Z'),
    engineOperationId: null,
    replied: false,
  };
  const make = (inbox: boolean | undefined, fetchImpl: unknown = async () => json(wire)) => {
    const practice = new FakeEngine();
    practice.inboxMessages.push(practiceMessage);
    return {
      practice,
      composite: new CompositeEngine(engineWith(fetchImpl, inbox), practice),
    };
  };

  it('shows practice messages only while the real engine has no inbox', async () => {
    const { composite } = make(undefined);
    expect(supportsInbox(composite)).toBe(true);
    expect(await composite.listInbox(range)).toEqual([practiceMessage]);
    expect(composite.capabilities().notes.join(' ')).toContain('practice messages only');
  });

  it('shows both when the real engine has one, and asks only the owner of a channel', async () => {
    const fetchImpl = vi.fn(async () => json(wire));
    const { composite } = make(true, fetchImpl);
    const all = await composite.listInbox(range);
    expect(all.map((m) => m.engineMessageId).sort()).toEqual([
      'int-1:c:cmt_1',
      'int-1:d:msg_2',
      'practice-message-1',
    ]);
    fetchImpl.mockClear();
    expect(await composite.listInbox(range, 'fake-facebook-1')).toEqual([practiceMessage]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await composite.listInbox(range, 'int-1')).length).toBe(2);
  });

  it('answers a practice message on the practice engine and a real one on the real engine, never crossed', async () => {
    const fetchImpl = vi.fn(async () => json({ replyId: 'r1' }));
    const { composite, practice } = make(true, fetchImpl);
    await composite.replyToMessage('practice-message-1', 'To practice');
    expect(practice.replies).toEqual([
      { engineMessageId: 'practice-message-1', text: 'To practice' },
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
    await composite.replyToMessage('int-1:c:cmt_1', 'To the engine');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(practice.replies).toHaveLength(1);
  });

  it('refuses a real reply when the real engine has no inbox, instead of sending it to the practice engine', () => {
    const { composite, practice } = make(undefined);
    expect(() => composite.replyToMessage('int-1:c:cmt_1', 'x')).toThrow(EngineUnsupportedError);
    expect(practice.replies).toHaveLength(0);
  });
});

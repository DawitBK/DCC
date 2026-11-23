import { describe, expect, it } from 'vitest';
import { CompositeEngine } from './composite';
import { FakeEngine } from './fake';
import { markApproved, supportsAnalytics, type OperationalEngine } from './engine';
import { EngineUnsupportedError, type PublishRequest } from './types';

const req = markApproved({
  idempotencyKey: 'c:1:fake-1',
  dccContentId: 'c',
  approvalVersion: 1,
  approverUserId: 'u',
  companyId: 'co',
  channelId: 'fake-1',
  text: 'Approved text',
  scheduledAt: null,
} satisfies PublishRequest);

describe('FakeEngine evidence and analytics', () => {
  it('lists what it published with the text, a network id and the "api" creation method', async () => {
    const engine = new FakeEngine();
    const { engineOperationId } = await engine.publish(req);
    const [post] = await engine.listPosts({
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000),
    });
    expect(post).toMatchObject({
      engineOperationId,
      content: 'Approved text',
      creationMethod: 'api',
    });
    expect(post!.networkPostId).toMatch(/^fake-network-/);
  });

  it('gives a scheduled post no network id yet', async () => {
    const engine = new FakeEngine();
    await engine.publish(markApproved({ ...req, scheduledAt: new Date(Date.now() + 3_600_000) }));
    const posts = await engine.listPosts({
      from: new Date(),
      to: new Date(Date.now() + 7_200_000),
    });
    expect(posts[0]!.networkPostId).toBeNull();
  });

  it('answers analytics with one point per day, and lets a test force the awkward answers', async () => {
    const engine = new FakeEngine();
    const ok = await engine.channelAnalytics('fake-1', 7);
    expect(ok.status).toBe('ok');
    expect(ok.series.every((s) => s.points.length === 7)).toBe(true);

    engine.analyticsAnswers.set('fake-2', { status: 'empty', windowDays: 1, series: [] });
    engine.analyticsAnswers.set('fake-post-9', { status: 'missing', windowDays: 1, series: [] });
    expect(await engine.channelAnalytics('fake-2', 30)).toEqual({
      status: 'empty',
      windowDays: 30,
      series: [],
    });
    expect((await engine.postAnalytics('fake-post-9', 30)).status).toBe('missing');
    await expect(engine.channelAnalytics('fake-1', 0)).rejects.toThrow(RangeError);
  });
});

describe('supportsAnalytics and CompositeEngine', () => {
  it('recognises an engine that has the two analytics methods and one that does not', () => {
    expect(supportsAnalytics(new FakeEngine())).toBe(true);
    expect(supportsAnalytics({} as object)).toBe(false);
  });

  it('sends a practice channel to the practice engine and refuses a real one the real engine cannot answer', async () => {
    const practice = new FakeEngine();
    const realWithoutAnalytics = {
      capabilities: () => ({
        provider: 'stub',
        listChannels: true,
        publish: true,
        listPosts: true,
        deletePost: true,
        verification: 'unverified',
        notes: [],
      }),
      listChannels: async () => [],
      publish: async () => ({ engineOperationId: 'x', engineChannelId: 'x' }),
      listPosts: async () => [],
      deletePost: async () => undefined,
    } as OperationalEngine;
    const composite = new CompositeEngine(realWithoutAnalytics, practice);

    expect((await composite.channelAnalytics('fake-1', 7)).status).toBe('ok');
    expect((await composite.postAnalytics('fake-post-3', 7)).status).toBe('ok');
    await expect(composite.channelAnalytics('real-channel', 7)).rejects.toThrow(
      EngineUnsupportedError,
    );
    await expect(composite.postAnalytics('real-post', 7)).rejects.toThrow(EngineUnsupportedError);
  });
});

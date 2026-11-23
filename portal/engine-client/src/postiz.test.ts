import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostizEngine } from './postiz';
import { markApproved } from './engine';
import { EngineOutcomeUnknownError, EngineRejectedError, type PublishRequest } from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const req = markApproved({
  idempotencyKey: 'k',
  dccContentId: 'c',
  approvalVersion: 1,
  approverUserId: 'u',
  companyId: 'co',
  channelId: 'int-1',
  text: 'hi',
  scheduledAt: null,
} satisfies PublishRequest);

describe('PostizEngine (stubbed HTTP; not a live Postiz test)', () => {
  it('sends the bare API key (no Bearer) and maps channels to DCC platforms', async () => {
    const fetchImpl = vi.fn(async () =>
      json([
        { id: 'int-1', name: 'Demo', identifier: 'linkedin-page' },
        { id: 'int-2', name: 'Other', identifier: 'mastodon' },
      ]),
    );
    const engine = new PostizEngine({
      baseUrl: 'https://p.example/api/public/v1/',
      apiKey: 'KEY',
      fetchImpl: fetchImpl as never,
    });
    const channels = await engine.listChannels();
    expect(channels.map((c) => c.platform)).toEqual(['linkedin', null]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://p.example/api/public/v1/integrations');
    expect((init.headers as Record<string, string>).Authorization).toBe('KEY');
  });

  it('reads account analytics for a channel and preserves Postiz metric labels', async () => {
    const metrics = [
      {
        label: 'Page Views',
        data: [{ total: 12, date: '2026-11-20' }],
        percentageChange: 5,
      },
    ];
    const fetchImpl = vi.fn(async () => json(metrics));
    const engine = new PostizEngine({
      baseUrl: 'https://p.example/api/public/v1',
      apiKey: 'KEY',
      fetchImpl: fetchImpl as never,
    });

    await expect(engine.getChannelAnalytics('integration/one', 30)).resolves.toEqual(metrics);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://p.example/api/public/v1/analytics/integration%2Fone?date=30');
    expect((init.headers as Record<string, string>).Authorization).toBe('KEY');
  });

  it('reads post analytics and preserves Postiz missing-state responses', async () => {
    const fetchImpl = vi.fn(async () => json({ missing: true }));
    const engine = new PostizEngine({
      baseUrl: 'https://p.example/api/public/v1',
      apiKey: 'KEY',
      fetchImpl: fetchImpl as never,
    });

    await expect(engine.getPostAnalytics('post/one', 14)).resolves.toEqual({ missing: true });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://p.example/api/public/v1/analytics/post/post%2Fone?date=14');
    await expect(engine.getPostAnalytics('post-2', 0)).rejects.toThrow(RangeError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves empty account analytics and maps provider errors', async () => {
    const engine = new PostizEngine({
      baseUrl: 'https://p.example/api/public/v1',
      apiKey: 'KEY',
      fetchImpl: (async () => json([])) as never,
    });
    await expect(engine.getChannelAnalytics('integration-1')).resolves.toEqual([]);

    const rejectedEngine = new PostizEngine({
      baseUrl: 'https://p.example/api/public/v1',
      apiKey: 'KEY',
      fetchImpl: (async () => json({}, 403)) as never,
    });
    await expect(rejectedEngine.getChannelAnalytics('integration-1')).rejects.toBeInstanceOf(
      EngineRejectedError,
    );

    const unknownEngine = new PostizEngine({
      baseUrl: 'https://p.example/api/public/v1',
      apiKey: 'KEY',
      fetchImpl: (async () => json({}, 502)) as never,
    });
    await expect(unknownEngine.getPostAnalytics('post-1')).rejects.toBeInstanceOf(
      EngineOutcomeUnknownError,
    );
  });

  it('publishes by posting the documented body and returns the post id', async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return url.endsWith('/integrations')
        ? json([{ id: 'int-1', identifier: 'x' }])
        : json([{ postId: 'post-9', integration: 'int-1' }]);
    };
    const engine = new PostizEngine({
      baseUrl: 'https://p.example/api/public/v1',
      apiKey: 'K',
      fetchImpl: fetchImpl as never,
    });
    const result = await engine.publish(req);
    expect(result).toEqual({ engineOperationId: 'post-9', engineChannelId: 'int-1' });
    const body = JSON.parse(calls[1]![1].body as string);
    expect(body.type).toBe('now');
    expect(body.posts[0].integration.id).toBe('int-1');
    expect(body.posts[0].value[0].content).toBe('hi');
  });

  it('uploads media first and puts the returned id and path in the post body', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dcc-postiz-upload-'));
    const mediaPath = join(directory, 'tiny.png');
    await writeFile(mediaPath, Buffer.from('test image bytes'));
    const calls: Array<[string, RequestInit]> = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith('/integrations'))
        return json([{ id: 'int-1', identifier: 'linkedin-page' }]);
      if (url.endsWith('/upload')) {
        expect((init.headers as Record<string, string>).Authorization).toBe('K');
        const file = (init.body as FormData).get('file') as File;
        expect(file.name).toBe('tiny.png');
        expect(file.type).toBe('image/png');
        return json({ id: 'media-1', path: '/uploads/media-1.png' });
      }
      return json([{ postId: 'post-10', integration: 'int-1' }]);
    };
    const engine = new PostizEngine({
      baseUrl: 'https://p.example/api/public/v1',
      apiKey: 'K',
      fetchImpl: fetchImpl as never,
    });

    try {
      const result = await engine.publish({
        ...req,
        media: [{ path: mediaPath, fileName: 'tiny.png', mimeType: 'image/png', kind: 'image' }],
      });
      expect(result.engineOperationId).toBe('post-10');
      expect(calls.map(([url]) => url.split('/').pop())).toEqual([
        'integrations',
        'upload',
        'posts',
      ]);
      const body = JSON.parse(calls[2]![1].body as string);
      expect(body.posts[0].value[0].image).toEqual([
        { id: 'media-1', path: '/uploads/media-1.png' },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('treats 4xx as a definite rejection and 5xx / network errors as unknown outcome', async () => {
    const make = (impl: () => Promise<Response>) =>
      new PostizEngine({ baseUrl: 'https://p.example/x', apiKey: 'K', fetchImpl: impl as never });
    await expect(make(async () => json({}, 403)).listChannels()).rejects.toBeInstanceOf(
      EngineRejectedError,
    );
    await expect(make(async () => json({}, 502)).listChannels()).rejects.toBeInstanceOf(
      EngineOutcomeUnknownError,
    );
    await expect(
      make(async () => {
        throw new TypeError('fetch failed');
      }).listChannels(),
    ).rejects.toBeInstanceOf(EngineOutcomeUnknownError);
  });

  it('never puts the API key in an error message', async () => {
    const engine = new PostizEngine({
      baseUrl: 'https://p.example/x',
      apiKey: 'SUPER-SECRET',
      fetchImpl: (async () => json({}, 500)) as never,
    });
    await expect(engine.listChannels()).rejects.not.toThrow(/SUPER-SECRET/);
  });

  it('maps listed posts', async () => {
    const engine = new PostizEngine({
      baseUrl: 'https://p.example/x',
      apiKey: 'K',
      fetchImpl: (async () =>
        json({
          posts: [
            {
              id: 'p1',
              state: 'PUBLISHED',
              publishDate: '2026-11-01T10:00:00Z',
              releaseURL: 'https://x.com/1',
              integration: { id: 'i1' },
            },
            { id: 'p2', state: 'ERROR', error: 'banned', integration: { id: 'i1' } },
          ],
        })) as never,
    });
    const posts = await engine.listPosts({
      from: new Date('2026-11-01'),
      to: new Date('2026-11-30'),
    });
    expect(posts.map((p) => p.state)).toEqual(['published', 'error']);
    expect(posts[1]!.error).toBe('banned');
  });
});

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

  it('uploads media without requiring a connected social channel', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dcc-postiz-upload-only-'));
    const mediaPath = join(directory, 'tiny.png');
    await writeFile(mediaPath, Buffer.from('test image bytes'));
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://p.example/api/public/v1/upload');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe('K');
      return json({ id: 'media-1', path: '/uploads/media-1.png' });
    });
    const engine = new PostizEngine({
      baseUrl: 'https://p.example/api/public/v1',
      apiKey: 'K',
      fetchImpl: fetchImpl as never,
    });

    try {
      await expect(
        engine.uploadMedia({
          path: mediaPath,
          fileName: 'tiny.png',
          mimeType: 'image/png',
          kind: 'image',
        }),
      ).resolves.toEqual({ id: 'media-1', path: '/uploads/media-1.png' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
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

  it('reports the text, the network post id and how each post was created', async () => {
    const engine = new PostizEngine({
      baseUrl: 'https://p.example/x',
      apiKey: 'K',
      fetchImpl: (async () =>
        json({
          posts: [
            {
              id: 'p1',
              state: 'PUBLISHED',
              content: '<p>Approved text</p>',
              releaseId: 'urn:li:share:1',
              creationMethod: 'API',
              integration: { id: 'i1' },
            },
            { id: 'p2', state: 'QUEUE', creationMethod: 'WEB', integration: { id: 'i1' } },
            {
              id: 'p3',
              state: 'QUEUE',
              creationMethod: 'SOMETHING_NEW',
              integration: { id: 'i1' },
            },
            { id: 'p4', state: 'QUEUE', integration: { id: 'i1' } },
          ],
        })) as never,
    });
    const posts = await engine.listPosts({
      from: new Date('2026-11-01'),
      to: new Date('2026-11-30'),
    });
    expect(posts[0]).toMatchObject({
      content: '<p>Approved text</p>',
      networkPostId: 'urn:li:share:1',
      creationMethod: 'api',
    });
    // A post made on the Postiz screen is told apart from one DCC made through the API.
    expect(posts[1]!.creationMethod).toBe('web');
    expect(posts[1]!.content).toBeNull();
    expect(posts[1]!.networkPostId).toBeNull();
    // A value this adapter does not know, or none at all, is 'unknown', never 'api'.
    expect(posts[2]!.creationMethod).toBe('unknown');
    expect(posts[3]!.creationMethod).toBe('unknown');
  });

  it('turns Postiz analytics into neutral results: own labels, numbers or null, no percentageChange', async () => {
    const engine = new PostizEngine({
      baseUrl: 'https://p.example/x',
      apiKey: 'K',
      fetchImpl: (async () =>
        json([
          {
            label: 'Page Impressions',
            percentageChange: 5,
            data: [
              { total: '120', date: '2026-11-20' },
              { total: 130, date: '2026-11-21' },
              { total: '', date: '2026-11-22' },
              { total: 'n/a', date: '2026-11-23' },
            ],
          },
        ])) as never,
    });
    const result = await engine.channelAnalytics('i1', 7);
    expect(result.status).toBe('ok');
    expect(result.windowDays).toBe(7);
    expect(result.series).toEqual([
      {
        label: 'Page Impressions',
        points: [
          { date: '2026-11-20', value: 120 },
          { date: '2026-11-21', value: 130 },
          // a blank or non-numeric total is null, never zero
          { date: '2026-11-22', value: null },
          { date: '2026-11-23', value: null },
        ],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('percentageChange');
  });

  it('keeps "no answer" and "post gone" apart from real readings', async () => {
    const empty = new PostizEngine({
      baseUrl: 'https://p.example/x',
      apiKey: 'K',
      fetchImpl: (async () => json([])) as never,
    });
    // An empty answer cannot be told from "no activity": it is 'empty', not a zero.
    expect(await empty.channelAnalytics('i1', 7)).toEqual({
      status: 'empty',
      windowDays: 7,
      series: [],
    });

    const missing = new PostizEngine({
      baseUrl: 'https://p.example/x',
      apiKey: 'K',
      fetchImpl: (async () => json({ missing: true })) as never,
    });
    expect(await missing.postAnalytics('p1', 30)).toEqual({
      status: 'missing',
      windowDays: 30,
      series: [],
    });
  });
});

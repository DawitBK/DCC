/**
 * W-03: run the Postiz adapter against a REAL Postiz (not the stub).
 *
 *   POSTIZ_BASE_URL=http://localhost:4007/api/public/v1 POSTIZ_API_KEY=<key> npm run verify:live -w @dcc/engine-client
 *
 * It runs read/refusal checks without a channel; publishing checks require POSTIZ_VERIFY_CHANNEL_ID.
 * Set POSTIZ_VERIFY_MEDIA_PATH to a small JPEG to test upload independently of a channel; this
 * leaves an asset in Postiz's library, so remove it there. With a channel id, the script schedules
 * one post a year ahead and deletes it, optionally including the media upload.
 * The API key and local media path are never printed.
 */
import {
  EngineOutcomeUnknownError,
  EngineRejectedError,
  PostizEngine,
  type EngineMedia,
} from '../src/index';

const baseUrl = process.env.POSTIZ_BASE_URL;
const apiKey = process.env.POSTIZ_API_KEY;
if (!baseUrl || !apiKey) {
  console.error('Set POSTIZ_BASE_URL and POSTIZ_API_KEY.');
  process.exit(2);
}

const say = (line: string) =>
  process.stdout.write(`${line}
`);
let failed = 0;
const check = async (name: string, run: () => Promise<string>) => {
  try {
    say(`PASS  ${name}: ${await run()}`);
  } catch (error) {
    failed += 1;
    say(`FAIL  ${name}: ${(error as Error).message}`);
  }
};
const expectError = async <T extends Error>(
  kind: new (...args: never[]) => T,
  run: () => Promise<unknown>,
): Promise<T> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof kind) return error;
    throw new Error(`wrong error kind: ${(error as Error).name}: ${(error as Error).message}`, {
      cause: error,
    });
  }
  throw new Error('it was accepted, but should have been refused');
};

const approved = (channelId: string, scheduledAt: Date | null, media?: EngineMedia[]) => ({
  idempotencyKey: `verify-${Date.now()}`,
  dccContentId: 'verify',
  approvalVersion: 1,
  approverUserId: 'verify',
  companyId: 'verify',
  channelId,
  text: 'DCC adapter verification. Safe to delete.',
  scheduledAt,
  ...(media ? { media } : {}),
  approved: true as const,
});

async function main() {
  const engine = new PostizEngine({ baseUrl: baseUrl!, apiKey: apiKey! });
  const day = 24 * 60 * 60 * 1000;
  const window = { from: new Date(Date.now() - 30 * day), to: new Date(Date.now() + 400 * day) };
  let authenticated = false;

  await check('authenticate and list channels', async () => {
    const channels = await engine.listChannels();
    authenticated = true;
    return `${channels.length} channel(s)${channels.map((c) => ` [${c.providerIdentifier}${c.platform ? '' : ' (no DCC platform)'}]`).join('')}`;
  });
  if (!authenticated) {
    say('SKIP  remaining checks: Postiz did not accept the configured URL and API key.');
    process.exitCode = 1;
    return;
  }
  await check('list posts', async () => `${(await engine.listPosts(window)).length} post(s)`);
  await check('a wrong key is refused, not "unknown"', async () => {
    const bad = new PostizEngine({ baseUrl: baseUrl!, apiKey: 'not-the-key' });
    const e = await expectError(EngineRejectedError, () => bad.listChannels());
    return e.message;
  });
  await check('a channel the engine does not have is refused before anything is sent', async () => {
    const e = await expectError(EngineRejectedError, () =>
      engine.publish(approved('no-such-channel', null) as never),
    );
    return e.message;
  });
  await check('an engine that does not answer is "outcome unknown"', async () => {
    const dead = new PostizEngine({
      baseUrl: 'http://127.0.0.1:9/api',
      apiKey: apiKey!,
      timeoutMs: 3000,
    });
    const e = await expectError(EngineOutcomeUnknownError, () => dead.listChannels());
    return e.message;
  });

  const channelId = process.env.POSTIZ_VERIFY_CHANNEL_ID;
  const mediaPath = process.env.POSTIZ_VERIFY_MEDIA_PATH;
  if (mediaPath && !channelId) {
    await check('upload media without publishing', async () => {
      const uploaded = await engine.uploadMedia({
        path: mediaPath,
        fileName: 'dcc-adapter-verification.jpg',
        mimeType: 'image/jpeg',
        kind: 'image',
      });
      if (!uploaded.id || !uploaded.path) throw new Error('Postiz returned no media reference.');
      return 'Postiz returned a media reference; remove the test asset from its library';
    });
  }
  if (channelId) {
    await check(
      mediaPath
        ? 'upload a JPEG, schedule a post a year ahead, find it, delete the post'
        : 'schedule a post a year ahead, find it, delete it',
      async () => {
        const media = mediaPath
          ? [
              {
                path: mediaPath,
                fileName: 'dcc-adapter-verification.jpg',
                mimeType: 'image/jpeg',
                kind: 'image' as const,
              },
            ]
          : undefined;
        const result = await engine.publish(
          approved(channelId, new Date(Date.now() + 365 * day), media) as never,
        );
        const found = (await engine.listPosts(window)).find(
          (p) => p.engineOperationId === result.engineOperationId,
        );
        if (!found) throw new Error('the scheduled post is not in the list');
        await engine.deletePost(result.engineOperationId);
        return `post ${found.state}, then deleted${media ? '; uploaded media remains in the Postiz library' : ''}`;
      },
    );
  } else {
    say('SKIP  schedule/delete: set POSTIZ_VERIFY_CHANNEL_ID (needs a connected test channel).');
    if (!mediaPath) say('SKIP  media upload: set POSTIZ_VERIFY_MEDIA_PATH to a local JPEG path.');
  }
  // exitCode, not process.exit(): on Windows, exiting while the "dead engine" check's connection is
  // still closing crashes Node (libuv assertion in src\win\async.c), turning a pass into a failure.
  process.exitCode = failed ? 1 : 0;
}
void main();

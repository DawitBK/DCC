/**
 * W-03: run the Postiz adapter against a REAL Postiz (not the stub).
 *
 *   POSTIZ_BASE_URL=http://localhost:4007/api/public/v1 POSTIZ_API_KEY=<key> npm run verify:live -w @dcc/engine-client
 *
 * It only reads and tries things that must be refused unless POSTIZ_VERIFY_CHANNEL_ID is given.
 * With a channel id, it schedules one post a year ahead and deletes it. Set POSTIZ_VERIFY_MEDIA_PATH
 * to a small JPEG path to exercise the adapter's image upload as part of that test. Postiz keeps
 * uploaded media in its library after the scheduled post is deleted; remove the test asset there.
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

const approved = (
  channelId: string,
  scheduledAt: Date | null,
  media?: EngineMedia[],
) => ({
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

  await check('list channels', async () => {
    const channels = await engine.listChannels();
    return `${channels.length} channel(s)${channels.map((c) => ` [${c.providerIdentifier}${c.platform ? '' : ' (no DCC platform)'}]`).join('')}`;
  });
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
    say(
      'SKIP  schedule/delete and media upload: set POSTIZ_VERIFY_CHANNEL_ID (needs a connected test network channel).',
    );
  }
  // exitCode, not process.exit(): on Windows, exiting while the "dead engine" check's connection is
  // still closing crashes Node (libuv assertion in src\win\async.c), turning a pass into a failure.
  process.exitCode = failed ? 1 : 0;
}
void main();

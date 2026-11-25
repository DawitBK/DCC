/**
 * End-to-end proof of the publishing path against a REAL Postiz and the practice network (development only).
 *
 * It walks the whole governed path through the DCC API as four different people, and then looks at the pretend
 * network to see whether the post really arrived:
 *   company_admin        registers a social account and links it to the practice channel
 *   content_creator      writes a draft and submits it
 *   company_marketing_manager  approves it (a different person from the author)
 *   publisher            publishes it now, schedules a second one, and cancels a third before its time
 * Then: the post must be on the practice network, the scheduled one must appear only after its time, and the
 * cancelled one must never appear.
 *
 * Needs (all on this computer):
 *   - the dev database container (default dcc-dev-postgres-1) with the practice people (`qa.<role>@example.test`;
 *     see scripts/verify/screens-pass.mjs for how to make them)
 *   - the DCC backend running with ENGINE_PROVIDER=postiz, DCC_ENGINE_ALLOW_UNVERIFIED=true and
 *     DCC_ENGINE_PRACTICE_NETWORK_PLATFORM=linkedin (the platform the practice channel counts as)
 *   - the engine running from an image that has the practice provider, started with the `practice` profile
 *     (docs/engine/PRACTICE-NETWORK.md), and one practice channel connected in the engine
 *
 *   POSTIZ_VERIFY_CHANNEL_ID=<the practice channel's id in the engine>  node scripts/verify/practice-network-e2e.mjs
 *
 * Optional: API (default http://localhost:7716), WEB_ORIGIN (default http://localhost:7717), PRACTICE_URL
 * (default http://localhost:4100), COMPANY_SLUG (default demo-company-a), DCC_DEV_DB_CONTAINER.
 * It never prints a session value or a key. It writes practice records into the development database only.
 */
import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const API = process.env.API || 'http://localhost:7716';
const ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:7717';
const PRACTICE = (process.env.PRACTICE_URL || 'http://localhost:4100').replace(/\/$/, '');
const CONTAINER = process.env.DCC_DEV_DB_CONTAINER || 'dcc-dev-postgres-1';
const SLUG = process.env.COMPANY_SLUG || 'demo-company-a';
const CHANNEL = process.env.POSTIZ_VERIFY_CHANNEL_ID;
if (!CHANNEL) {
  console.error(
    'Set POSTIZ_VERIFY_CHANNEL_ID to the practice channel id (see the header of this file).',
  );
  process.exit(2);
}

const sql = (query) =>
  execSync(
    `docker exec ${CONTAINER} psql -U postgres -d dcc_dev -At -c "${query.replaceAll('"', '\\"')}"`,
    {
      encoding: 'utf8',
    },
  ).trim();
const userId = (role) => sql(`select id from users where email='qa.${role}@example.test'`);
const session = (role) => {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  sql(
    `insert into sessions (id_hash, user_id, expires_at, authenticated_at) select '${hash}', id, now() + interval '2 hours', now() from users where email='qa.${role}@example.test'`,
  );
  return token;
};
const cookies = {};
const as = (role) => (cookies[role] ??= `dcc_sid=${session(role)}`);

const call = async (role, method, path, body) => {
  const response = await fetch(API + '/api' + path, {
    method,
    headers: {
      cookie: as(role),
      origin: ORIGIN,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: response.status, json };
};

const results = [];
const step = async (name, run) => {
  try {
    const detail = await run();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${detail ? `: ${detail}` : ''}`);
    return true;
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}: ${error.message}`);
    return false;
  }
};
const expect = (cond, message) => {
  if (!cond) throw new Error(message);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const practicePosts = async () => (await (await fetch(PRACTICE + '/api/posts')).json()) ?? [];
const until = async (find, seconds) => {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const found = await find();
    if (found) return found;
    if (Date.now() > end) return null;
    await wait(2000);
  }
};

const stamp = new Date().toISOString().slice(11, 19).replaceAll(':', '');
let companyId;
let accountId;
const publishDraft = async (label, scheduledAt) => {
  const text = `Practice network proof ${label} ${stamp}-${randomBytes(3).toString('hex')}`;
  const draft = await call('content_creator', 'POST', '/content-items', {
    companyId,
    body: text,
    targetAccountIds: [accountId],
  });
  expect(
    draft.status === 201 || draft.status === 200,
    `draft refused (${draft.status}): ${JSON.stringify(draft.json)}`,
  );
  const submitted = await call('content_creator', 'POST', `/content-items/${draft.json.id}/submit`);
  expect(
    submitted.status < 300,
    `submit refused (${submitted.status}): ${JSON.stringify(submitted.json)}`,
  );
  const approved = await call(
    'company_marketing_manager',
    'POST',
    `/approval-requests/${submitted.json.id}/approve`,
    {},
  );
  expect(
    approved.status < 300,
    `approve refused (${approved.status}): ${JSON.stringify(approved.json)}`,
  );
  const published = await call('publisher', 'POST', `/content-items/${draft.json.id}/publish`, {
    socialAccountId: accountId,
    ...(scheduledAt ? { scheduledAt } : {}),
  });
  expect(
    published.status < 300,
    `publish refused (${published.status}): ${JSON.stringify(published.json)}`,
  );
  return { text, itemId: draft.json.id, publication: published.json };
};

console.log(`DCC ${API}  |  practice network ${PRACTICE}  |  channel ${CHANNEL}\n`);

await step('the practice network is reachable and empty enough to read', async () => {
  const response = await fetch(PRACTICE + '/health');
  expect(response.ok, `health answered ${response.status}`);
  return `${(await response.json()).posts} post(s) already there`;
});

await step('DCC sees the practice channel as a governed channel', async () => {
  companyId = sql(`select id from companies where slug='${SLUG}'`);
  expect(companyId, `no company with slug ${SLUG}`);
  const channels = await call('company_admin', 'GET', '/engine/channels');
  expect(channels.status === 200, `channels answered ${channels.status}`);
  const channel = channels.json.find((c) => c.engineChannelId === CHANNEL);
  expect(channel, 'the channel is not in the engine list');
  expect(
    channel.platform,
    'the channel has no DCC platform: start the backend with DCC_ENGINE_PRACTICE_NETWORK_PLATFORM=linkedin',
  );
  return `${channel.name} counts as ${channel.platform}`;
});

await step('a company administrator registers an account and links it to the channel', async () => {
  const created = await call('company_admin', 'POST', '/social-accounts', {
    companyId,
    platform: 'linkedin',
    displayName: `Practice network ${stamp}`,
    handle: `@practice-${stamp}`,
    ownerUserId: userId('publisher'),
  });
  expect(
    created.status === 201 || created.status === 200,
    `register refused (${created.status}): ${JSON.stringify(created.json)}`,
  );
  accountId = created.json.id;
  const linked = await call(
    'company_admin',
    'PATCH',
    `/social-accounts/${accountId}/engine-channel`,
    { engineChannelId: CHANNEL },
  );
  expect(linked.status < 300, `link refused (${linked.status}): ${JSON.stringify(linked.json)}`);
});

let now;
await step(
  'publish now: creator drafts, a different person approves, the publisher publishes',
  async () => {
    now = await publishDraft('now');
    return `publication ${now.publication.status}`;
  },
);
await step(
  'the post is really on the practice network (published, with the approved text)',
  async () => {
    const post = await until(
      async () =>
        (await practicePosts()).find((p) => p.text === now.text && p.state === 'published'),
      90,
    );
    expect(post, 'the post did not arrive within 90 seconds');
    return post.url;
  },
);

let later;
await step('schedule: a post is held by the engine until its time', async () => {
  const at = new Date(Date.now() + 2 * 60_000).toISOString();
  later = await publishDraft('scheduled', at);
  const early = (await practicePosts()).find((p) => p.text === later.text);
  expect(!early, 'the scheduled post is already on the network before its time');
  return `due ${at}`;
});

let cancelled;
await step('cancel: a scheduled post is cancelled and never reaches the network', async () => {
  const at = new Date(Date.now() + 3 * 60_000).toISOString();
  cancelled = await publishDraft('cancelled', at);
  const response = await call(
    'publisher',
    'POST',
    `/publications/${cancelled.publication.id}/cancel`,
  );
  expect(
    response.status < 300,
    `cancel refused (${response.status}): ${JSON.stringify(response.json)}`,
  );
});

await step('the scheduled post arrives after its time', async () => {
  const post = await until(
    async () =>
      (await practicePosts()).find((p) => p.text === later.text && p.state === 'published'),
    240,
  );
  expect(post, 'the scheduled post did not arrive within 4 minutes');
  return post.url;
});
await step('the cancelled post never arrived', async () => {
  const post = (await practicePosts()).find((p) => p.text === cancelled.text);
  expect(!post, 'the cancelled post is on the network');
});

await step(
  'DCC records the publications (published, scheduled then published, cancelled)',
  async () => {
    const response = await call('publisher', 'GET', '/publications');
    expect(response.status === 200, `list answered ${response.status}`);
    const status = (id) => response.json.find((p) => p.id === id)?.status;
    expect(status(now.publication.id) === 'published', `first is ${status(now.publication.id)}`);
    expect(
      status(cancelled.publication.id) === 'cancelled',
      `third is ${status(cancelled.publication.id)}`,
    );
    return `first ${status(now.publication.id)}, scheduled ${status(later.publication.id)}, third ${status(cancelled.publication.id)}`;
  },
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
process.exitCode = failed ? 1 : 0;

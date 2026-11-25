import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeNetwork } from './server.mjs';

let server;
let base;
let clock = Date.parse('2026-11-25T10:00:00Z');

before(async () => {
  server = createPracticeNetwork({ now: () => clock });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path, body) => {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
};

test('an account is created once and fetched by handle', async () => {
  await call('POST', '/api/reset');
  const a = await call('POST', '/api/accounts', {
    handle: 'Kerchanshe_Coffee',
    name: 'Kerchanshe Coffee',
  });
  assert.equal(a.status, 200);
  assert.equal(a.json.handle, 'kerchanshe_coffee');
  const again = await call('POST', '/api/accounts', { handle: 'kerchanshe_coffee' });
  assert.equal(again.json.id, a.json.id);
  assert.equal((await call('GET', '/api/accounts/KERCHANSHE_COFFEE')).json.id, a.json.id);
  assert.equal((await call('GET', '/api/accounts/nobody')).status, 404);
});

test('an account keeps its id when the network restarts, because the id comes from the handle', async () => {
  await call('POST', '/api/reset');
  const first = (await call('POST', '/api/accounts', { handle: 'Kerchanshe-Practice' })).json;
  await call('POST', '/api/reset');
  const again = (await call('POST', '/api/accounts', { handle: 'kerchanshe-practice' })).json;
  assert.equal(again.id, first.id);
  assert.notEqual(
    (await call('POST', '/api/accounts', { handle: 'someone-else' })).json.id,
    first.id,
  );
});

test('a post is published at once, listed, read and deleted', async () => {
  await call('POST', '/api/reset');
  const { json: account } = await call('POST', '/api/accounts', { handle: 'brand' });
  const created = await call('POST', '/api/posts', {
    accountId: account.id,
    text: 'Hello world',
    media: ['/uploads/a.jpg'],
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.state, 'published');
  assert.match(created.json.url, /\/p\/post_/);
  assert.deepEqual(created.json.media, ['/uploads/a.jpg']);
  assert.equal((await call('GET', `/api/posts?accountId=${account.id}`)).json.length, 1);
  assert.equal((await call('GET', `/api/posts/${created.json.id}`)).json.text, 'Hello world');
  assert.equal((await call('DELETE', `/api/posts/${created.json.id}`)).status, 200);
  assert.equal((await call('GET', `/api/posts/${created.json.id}`)).status, 404);
  assert.equal((await call('DELETE', `/api/posts/${created.json.id}`)).status, 404);
});

test('a scheduled post stays scheduled until its time has passed', async () => {
  await call('POST', '/api/reset');
  const { json: account } = await call('POST', '/api/accounts', { handle: 'brand' });
  const at = new Date(clock + 3600_000).toISOString();
  const post = (
    await call('POST', '/api/posts', { accountId: account.id, text: 'Later', scheduledAt: at })
  ).json;
  assert.equal(post.state, 'scheduled');
  assert.equal((await call('GET', `/api/posts/${post.id}`)).json.state, 'scheduled');
  clock += 2 * 3600_000;
  const after = (await call('GET', `/api/posts/${post.id}`)).json;
  assert.equal(after.state, 'published');
  assert.equal(after.publishedAt, at);
  clock -= 2 * 3600_000;
});

test('comments only on published posts; the account can answer itself', async () => {
  await call('POST', '/api/reset');
  const { json: account } = await call('POST', '/api/accounts', { handle: 'brand' });
  const scheduled = (
    await call('POST', '/api/posts', {
      accountId: account.id,
      text: 'Soon',
      scheduledAt: new Date(clock + 9e6).toISOString(),
    })
  ).json;
  assert.equal(
    (await call('POST', `/api/posts/${scheduled.id}/comments`, { authorName: 'Fan', text: 'Hi' }))
      .status,
    404,
  );
  const post = (await call('POST', '/api/posts', { accountId: account.id, text: 'Now' })).json;
  assert.equal(
    (await call('POST', `/api/posts/${post.id}/comments`, { authorName: 'Fan', text: 'Nice' }))
      .status,
    201,
  );
  await call('POST', `/api/posts/${post.id}/comments`, {
    authorName: 'Brand',
    text: 'Thanks',
    fromSelf: true,
  });
  const list = (await call('GET', `/api/posts/${post.id}/comments`)).json;
  assert.deepEqual(
    list.map((c) => [c.authorName, c.fromSelf]),
    [
      ['Fan', false],
      ['Brand', true],
    ],
  );
  assert.equal((await call('GET', `/api/posts/${post.id}`)).json.commentCount, 2);
});

test('a reply of the account records which comment it answers', async () => {
  await call('POST', '/api/reset');
  const { json: account } = await call('POST', '/api/accounts', { handle: 'brand' });
  const post = (await call('POST', '/api/posts', { accountId: account.id, text: 'Hello' })).json;
  const fan = (
    await call('POST', `/api/posts/${post.id}/comments`, {
      authorName: 'Fan',
      text: 'Open on Sunday?',
    })
  ).json;
  assert.equal(fan.parentId, null);
  const reply = (
    await call('POST', `/api/posts/${post.id}/comments`, {
      authorName: 'Brand',
      text: 'Yes, from 9',
      fromSelf: true,
      parentId: fan.id,
    })
  ).json;
  assert.equal(reply.parentId, fan.id);
  const list = (await call('GET', `/api/posts/${post.id}/comments`)).json;
  assert.deepEqual(
    list.map((c) => c.parentId),
    [null, fan.id],
  );
});

test('direct messages form a conversation that the account can answer', async () => {
  await call('POST', '/api/reset');
  const { json: account } = await call('POST', '/api/accounts', { handle: 'brand' });
  const first = (
    await call('POST', '/api/messages', {
      accountId: account.id,
      from: 'Abebe K',
      text: 'Are you open?',
    })
  ).json;
  assert.equal(first.threadId, 'thread_abebe-k');
  const reply = await call('POST', `/api/messages/${first.threadId}/reply`, {
    accountId: account.id,
    text: 'Yes, until 6',
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.json.fromSelf, true);
  const all = (await call('GET', `/api/messages?accountId=${account.id}`)).json;
  assert.deepEqual(
    all.map((m) => m.fromSelf),
    [false, true],
  );
  assert.equal(
    (await call('POST', '/api/messages/thread_nobody/reply', { accountId: account.id, text: 'x' }))
      .status,
    404,
  );
});

test('analytics are deterministic and grow with posts and comments', async () => {
  await call('POST', '/api/reset');
  const { json: account } = await call('POST', '/api/accounts', { handle: 'brand' });
  const before = (await call('GET', `/api/analytics?accountId=${account.id}&days=7`)).json;
  assert.deepEqual(
    before.map((s) => s.label),
    ['Followers', 'Impressions', 'Engagement'],
  );
  assert.equal(before[0].data.length, 7);
  const post = (await call('POST', '/api/posts', { accountId: account.id, text: 'A' })).json;
  await call('POST', `/api/posts/${post.id}/comments`, { authorName: 'Fan', text: 'Hi' });
  const later = (await call('GET', `/api/analytics?accountId=${account.id}&days=7`)).json;
  assert.ok(Number(later[0].data.at(-1).total) > Number(before[0].data.at(-1).total));
  assert.equal(
    JSON.stringify(later),
    JSON.stringify((await call('GET', `/api/analytics?accountId=${account.id}&days=7`)).json),
  );
  const perPost = (await call('GET', `/api/posts/${post.id}/analytics?days=3`)).json;
  assert.deepEqual(
    perPost.map((s) => s.label),
    ['Views', 'Comments'],
  );
});

test('bad input is refused with a clear answer, never a crash', async () => {
  await call('POST', '/api/reset');
  assert.equal((await call('POST', '/api/accounts', { handle: 'x' })).status, 400);
  assert.equal((await call('POST', '/api/accounts', {})).status, 400);
  assert.equal(
    (await call('POST', '/api/posts', { accountId: 'acc_none', text: 'x' })).status,
    404,
  );
  const { json: account } = await call('POST', '/api/accounts', { handle: 'brand' });
  assert.equal(
    (await call('POST', '/api/posts', { accountId: account.id, text: '   ' })).status,
    400,
  );
  assert.equal(
    (
      await call('POST', '/api/posts', {
        accountId: account.id,
        text: 'x',
        scheduledAt: 'not a date',
      })
    ).status,
    400,
  );
  const broken = await fetch(base + '/api/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{nope',
  });
  assert.equal(broken.status, 400);
  assert.equal((await call('GET', '/api/nothing')).status, 404);
});

test('the page shows what arrived and escapes what people wrote', async () => {
  await call('POST', '/api/reset');
  const { json: account } = await call('POST', '/api/accounts', { handle: 'brand' });
  await call('POST', '/api/posts', { accountId: account.id, text: '<script>alert(1)</script> hi' });
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; hi/);
  assert.doesNotMatch(html, /<script>alert/);
});

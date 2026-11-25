/**
 * The practice network: a tiny pretend social network for development and tests (no dependencies, in memory).
 *
 * The engine (Postiz) can be given a "practice" channel type that talks to this server instead of a real network,
 * so publishing, scheduling, deleting, comments, direct messages and analytics can be proven end to end through DCC
 * without any developer app. It is NOT a real network and stores nothing durable: a restart empties it.
 *
 *   node operational-engine/practice-network/server.mjs            (port 4100, or PRACTICE_NETWORK_PORT)
 *
 * API (JSON). Every answer is {...} or {"error": "..."} with a matching status.
 *   GET    /health
 *   POST   /api/accounts               {handle, name?}                       create or fetch an account (its id comes from the handle, so a restart does not change it)
 *   GET    /api/accounts/:handle
 *   POST   /api/posts                  {accountId, text, media?[], scheduledAt?}  publish (or schedule) a post
 *   GET    /api/posts?accountId=       the account's posts, newest first
 *   GET    /api/posts/:id
 *   DELETE /api/posts/:id
 *   POST   /api/posts/:id/comments     {authorName, text, fromSelf?, parentId?}  a fan comments (fromSelf: the account itself; parentId: the comment it answers)
 *   GET    /api/posts/:id/comments
 *   POST   /api/messages               {accountId, from, text}               a fan sends a direct message
 *   GET    /api/messages?accountId=    direct messages of the account, oldest first
 *   POST   /api/messages/:threadId/reply {accountId, text}                   the account answers a conversation
 *   GET    /api/analytics?accountId=&days=   follower and reach figures (deterministic, from what exists here)
 *   GET    /api/posts/:id/analytics?days=
 *   POST   /api/reset                  empty everything (tests)
 *   GET    /                           a simple page showing every post, so a person can see what arrived
 *
 * A scheduled post (scheduledAt in the future) is stored with state "scheduled" and becomes "published" when the time
 * has passed, the next time anyone asks: there is no background clock to keep it simple and predictable.
 */
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

export function createPracticeNetwork({
  baseUrl = 'http://localhost:4100',
  now = () => Date.now(),
} = {}) {
  const accounts = new Map(); // handle -> account
  const posts = new Map(); // id -> post
  const comments = new Map(); // postId -> comment[]
  const messages = []; // direct messages, oldest first

  const iso = (ms) => new Date(ms).toISOString();
  const settle = (post) => {
    if (post.state === 'scheduled' && Date.parse(post.scheduledAt) <= now()) {
      post.state = 'published';
      post.publishedAt = post.scheduledAt;
    }
    return post;
  };
  const view = (post) => ({ ...settle(post), commentCount: (comments.get(post.id) ?? []).length });

  class HttpError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  const need = (cond, status, message) => {
    if (!cond) throw new HttpError(status, message);
  };
  const text = (v, name, max = 5000) => {
    need(typeof v === 'string' && v.trim().length > 0, 400, `${name} is required`);
    need(v.length <= max, 400, `${name} is too long`);
    return v;
  };
  const accountById = (id) => {
    for (const a of accounts.values()) if (a.id === id) return a;
    throw new HttpError(404, 'no such account');
  };

  /** Deterministic figures from what exists: followers grow with posts and comments, so a test can predict them. */
  const series = (accountId, days) => {
    const mine = [...posts.values()].filter(
      (p) => p.accountId === accountId && settle(p).state === 'published',
    );
    const comm = mine.reduce((n, p) => n + (comments.get(p.id) ?? []).length, 0);
    const end = now();
    const points = (valueAt) =>
      Array.from({ length: days }, (_, i) => ({
        date: iso(end - (days - 1 - i) * 86400000).slice(0, 10),
        total: String(valueAt(i)),
      }));
    return [
      {
        label: 'Followers',
        data: points((i) => 100 + mine.length * 10 + Math.floor((i * (1 + comm)) / 2)),
      },
      { label: 'Impressions', data: points((i) => (mine.length + 1) * 50 + i * 5 + comm * 20) },
      { label: 'Engagement', data: points(() => comm + mine.length) },
    ];
  };

  async function route(method, url, body) {
    const path = url.pathname;
    const q = url.searchParams;
    if (method === 'GET' && path === '/health')
      return [200, { status: 'ok', accounts: accounts.size, posts: posts.size }];
    if (method === 'POST' && path === '/api/reset') {
      accounts.clear();
      posts.clear();
      comments.clear();
      messages.length = 0;
      return [200, { status: 'empty' }];
    }
    if (method === 'POST' && path === '/api/accounts') {
      const handle = text(body.handle, 'handle', 60).trim().toLowerCase();
      need(
        /^[a-z0-9_.-]{2,60}$/.test(handle),
        400,
        'handle may use letters, digits, dot, dash and underscore',
      );
      let account = accounts.get(handle);
      if (!account) {
        account = {
          id: `acc_${createHash('sha1').update(handle).digest('hex').slice(0, 8)}`,
          handle,
          name: body.name?.trim() || handle,
          picture: '',
        };
        accounts.set(handle, account);
      }
      return [200, account];
    }
    let m = path.match(/^\/api\/accounts\/([^/]+)$/);
    if (method === 'GET' && m) {
      const account = accounts.get(decodeURIComponent(m[1]).toLowerCase());
      need(account, 404, 'no such account');
      return [200, account];
    }
    if (method === 'POST' && path === '/api/posts') {
      const account = accountById(text(body.accountId, 'accountId', 80));
      const content = text(body.text, 'text', 5000);
      const scheduledMs = body.scheduledAt ? Date.parse(body.scheduledAt) : NaN;
      need(!body.scheduledAt || !Number.isNaN(scheduledMs), 400, 'scheduledAt is not a date');
      const future = !Number.isNaN(scheduledMs) && scheduledMs > now();
      const id = `post_${randomUUID().slice(0, 8)}`;
      const post = {
        id,
        accountId: account.id,
        handle: account.handle,
        text: content,
        media: Array.isArray(body.media)
          ? body.media.filter((x) => typeof x === 'string').slice(0, 10)
          : [],
        state: future ? 'scheduled' : 'published',
        createdAt: iso(now()),
        scheduledAt: future ? iso(scheduledMs) : null,
        publishedAt: future ? null : iso(now()),
        url: `${baseUrl}/p/${id}`,
      };
      posts.set(id, post);
      return [201, view(post)];
    }
    if (method === 'GET' && path === '/api/posts') {
      const accountId = q.get('accountId');
      const list = [...posts.values()]
        .filter((p) => !accountId || p.accountId === accountId)
        .map(view)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return [200, list];
    }
    m = path.match(/^\/api\/posts\/([^/]+)$/);
    if (m && method === 'GET') {
      const post = posts.get(m[1]);
      need(post, 404, 'no such post');
      return [200, view(post)];
    }
    if (m && method === 'DELETE') {
      need(posts.delete(m[1]), 404, 'no such post');
      comments.delete(m[1]);
      return [200, { deleted: m[1] }];
    }
    m = path.match(/^\/api\/posts\/([^/]+)\/comments$/);
    if (m && method === 'POST') {
      const post = posts.get(m[1]);
      need(post && settle(post).state === 'published', 404, 'no such published post');
      const comment = {
        id: `cmt_${randomUUID().slice(0, 8)}`,
        postId: post.id,
        authorName: text(body.authorName, 'authorName', 80),
        text: text(body.text, 'text', 2000),
        fromSelf: body.fromSelf === true,
        parentId: typeof body.parentId === 'string' ? body.parentId : null,
        createdAt: iso(now()),
      };
      comments.set(post.id, [...(comments.get(post.id) ?? []), comment]);
      return [201, comment];
    }
    if (m && method === 'GET') {
      need(posts.has(m[1]), 404, 'no such post');
      return [200, comments.get(m[1]) ?? []];
    }
    if (method === 'POST' && path === '/api/messages') {
      const account = accountById(text(body.accountId, 'accountId', 80));
      const from = text(body.from, 'from', 80);
      const msg = {
        id: `msg_${randomUUID().slice(0, 8)}`,
        accountId: account.id,
        threadId: `thread_${from.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        authorName: from,
        text: text(body.text, 'text', 2000),
        fromSelf: false,
        createdAt: iso(now()),
      };
      messages.push(msg);
      return [201, msg];
    }
    if (method === 'GET' && path === '/api/messages') {
      const accountId = q.get('accountId');
      return [200, messages.filter((x) => !accountId || x.accountId === accountId)];
    }
    m = path.match(/^\/api\/messages\/([^/]+)\/reply$/);
    if (m && method === 'POST') {
      const account = accountById(text(body.accountId, 'accountId', 80));
      const thread = messages.filter((x) => x.threadId === m[1] && x.accountId === account.id);
      need(thread.length > 0, 404, 'no such conversation');
      const reply = {
        id: `msg_${randomUUID().slice(0, 8)}`,
        accountId: account.id,
        threadId: m[1],
        authorName: account.name,
        text: text(body.text, 'text', 2000),
        fromSelf: true,
        createdAt: iso(now()),
      };
      messages.push(reply);
      return [201, reply];
    }
    if (method === 'GET' && path === '/api/analytics') {
      const account = accountById(text(q.get('accountId') ?? '', 'accountId', 80));
      const days = Math.min(Math.max(Number(q.get('days')) || 30, 1), 90);
      return [200, series(account.id, days)];
    }
    m = path.match(/^\/api\/posts\/([^/]+)\/analytics$/);
    if (m && method === 'GET') {
      const post = posts.get(m[1]);
      need(post, 404, 'no such post');
      const n = (comments.get(post.id) ?? []).length;
      const days = Math.min(Math.max(Number(q.get('days')) || 30, 1), 90);
      const end = now();
      const points = (value) =>
        Array.from({ length: days }, (_, i) => ({
          date: iso(end - (days - 1 - i) * 86400000).slice(0, 10),
          total: String(value(i)),
        }));
      return [
        200,
        [
          { label: 'Views', data: points((i) => 20 + i * 3 + n * 10) },
          { label: 'Comments', data: points(() => n) },
        ],
      ];
    }
    return [404, { error: 'unknown route' }];
  }

  const escapeHtml = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const page = (post) => {
    const items = (comments.get(post.id) ?? [])
      .map((c) => `<li><b>${escapeHtml(c.authorName)}</b>: ${escapeHtml(c.text)}</li>`)
      .join('');
    return `<article id="${post.id}"><h3>@${escapeHtml(post.handle)} <small>${post.state}</small></h3><p>${escapeHtml(post.text)}</p><ul>${items}</ul></article>`;
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/p/'))) {
        const id = url.pathname.startsWith('/p/') ? url.pathname.slice(3) : null;
        const list = id
          ? [posts.get(id)].filter(Boolean)
          : [...posts.values()].map(settle).reverse();
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Practice network</title><h1>Practice network</h1><p>A pretend network for testing. Not real.</p>${list.map(page).join('') || '<p>No posts yet.</p>'}`,
        );
        return;
      }
      let body = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1_000_000) throw new HttpError(413, 'body too large');
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          throw new HttpError(400, 'the body is not valid JSON');
        }
        if (body === null || typeof body !== 'object')
          throw new HttpError(400, 'the body must be a JSON object');
      }
      const [status, payload] = await route(req.method ?? 'GET', url, body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: status === 500 ? 'internal error' : error.message }));
    }
  });
  return server;
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())
) {
  const port = Number(process.env.PRACTICE_NETWORK_PORT || 4100);
  const baseUrl = process.env.PRACTICE_NETWORK_PUBLIC_URL || `http://localhost:${port}`;
  createPracticeNetwork({ baseUrl }).listen(port, '0.0.0.0', () =>
    console.log(`practice network on ${port}`),
  );
}

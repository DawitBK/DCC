// Real-browser checks of DCC sign-in against a running Kerchanshe SSO: section A of
// docs/testing/INTEGRATION-TEST-PLAN.md. Dawit's tool, run by hand on a DEVELOPMENT setup only.
//
// It drives a real browser (Microsoft Edge by default) through the SSO's own pages: password, authenticator
// code, sign in again, sign out. It uses the SSO's test people (qa.*@qa.local) and changes their two-factor
// state, their DCC application role and, for one test, the SSO setting `mfa.requiredApps` (put back at the
// end). NEVER point it at the mirror or at production.
//
// It needs a browser driver that is NOT a dependency of this repository: the `playwright-core` package from
// another checkout on this PC (the SSO frontend has it). Tell it where:
//
//   SSO_TEST_PASSWORD=<the dev practice password> PLAYWRIGHT_FROM=<folder with node_modules/playwright-core> \
//     node scripts/verify/sso-browser-checks.mjs
//
// Settings (all optional except the password): SSO_URL (default http://localhost:7301), DCC_URL (default
// DCC_WEB_ORIGIN from .env), DCC_REAUTH_MAX_AGE_MINUTES and SESSION_IDLE_MINUTES (must be what the running
// backend uses; the script really waits that long, so start the backend with small values for a quick run),
// BROWSER_CHANNEL (msedge | chrome), RESULTS_FILE, ONLY=sso-down (run just the "SSO does not answer" test,
// with the SSO stopped).
import { createHmac } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env')); // never overrides what is already set
const env = process.env;

const SSO = (env.SSO_URL ?? 'http://localhost:7301').replace(/\/$/, '');
const DCC = (env.DCC_URL ?? env.DCC_WEB_ORIGIN ?? 'http://localhost:7717').replace(/\/$/, '');
const PASSWORD = env.SSO_TEST_PASSWORD;
const REAUTH_MINUTES = Number(env.DCC_REAUTH_MAX_AGE_MINUTES ?? 15);
const IDLE_MINUTES = Number(env.SESSION_IDLE_MINUTES ?? 30);
const PEOPLE = {
  ssoAdmin: env.SSO_ADMIN_EMAIL ?? 'qa.ssoadmin@qa.local',
  platformAdmin: env.SSO_PLATFORM_ADMIN_EMAIL ?? 'qa.hiddenowner@qa.local',
  admin: env.DCC_TEST_ADMIN ?? 'qa.mfa@qa.local', // gets an authenticator and the dcc-group-admin role
  second: env.DCC_TEST_SECOND ?? 'qa.bulk2@qa.local', // gets an authenticator, starts with no DCC role
  noMfa: env.DCC_TEST_NO_MFA ?? 'qa.bulk1@qa.local', // never gets an authenticator
};

if (!PASSWORD)
  fail('Set SSO_TEST_PASSWORD (the development practice password of the qa.* people).');
for (const url of [SSO, DCC]) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url))
    fail(`Refused: ${url} is not a development address on this computer.`);
}
if ((env.DCC_ENVIRONMENT ?? 'development') !== 'development')
  fail('Refused: this is for a development setup only.');

function fail(message) {
  console.error(message);
  process.exit(2);
}
const requireFrom = (dir) => createRequire(resolve(dir, 'package.json'));
let chromium;
try {
  ({ chromium } = requireFrom(env.PLAYWRIGHT_FROM ?? root)('playwright-core'));
} catch {
  fail(
    'playwright-core not found. Set PLAYWRIGHT_FROM to a folder that has node_modules/playwright-core.',
  );
}
const pg = requireFrom(root)('pg');

// ---------------------------------------------------------------------------------------------------------
// Small tools
// ---------------------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (id, name, status, detail) => {
  results.push({ id, name, status, detail });
  console.log(
    `${status.toUpperCase().padEnd(4)} ${id.padEnd(4)} ${name}${detail ? `\n          ${detail}` : ''}`,
  );
};
/** Runs one check; a thrown error is a failure of that check, and the run goes on. */
const ONLY_CHECKS = env.CHECKS ? env.CHECKS.split(',') : null; // e.g. CHECKS=5 runs the preparation and that one check
async function check(id, name, work) {
  if (ONLY_CHECKS && !ONLY_CHECKS.includes(id)) return;
  try {
    record(id, name, 'pass', await work());
  } catch (error) {
    record(id, name, 'fail', String(error?.message ?? error).split('\n')[0]);
  }
}
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

/** RFC 6238 (SHA-1, 6 digits, 30 s). One code is never used twice: the SSO refuses a replayed code. */
class Authenticator {
  constructor(secret) {
    this.secret = secret;
    this.lastStep = 0;
  }
  async code() {
    let step = Math.floor(Date.now() / 30_000);
    if (step <= this.lastStep) {
      await sleep((this.lastStep + 1) * 30_000 - Date.now() + 500);
      step = Math.floor(Date.now() / 30_000);
    }
    this.lastStep = step;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const ch of this.secret.replace(/[\s=]/g, '').toUpperCase())
      bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
    const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(step));
    const h = createHmac('sha1', key).update(msg).digest();
    const off = h[h.length - 1] & 0xf;
    const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
    return String(n % 1_000_000).padStart(6, '0');
  }
}

const db = new pg.Client({ connectionString: env.DCC_MIGRATE_DATABASE_URL });
const sql = async (text, values = []) => (await db.query(text, values)).rows;
const dccUserId = async (email) =>
  (await sql('select id from users where email = $1', [email]))[0]?.id;
const auditOf = async (email, action, sinceIso) =>
  sql(
    `select a.action, a.details from audit_events a join users u on u.id = a.actor_user_id
      where u.email = $1 and a.action = $2 and a.occurred_at >= $3 order by a.id desc`,
    [email, action, sinceIso],
  );

// ---------------------------------------------------------------------------------------------------------
// The SSO's pages
// ---------------------------------------------------------------------------------------------------------
const REFUSED_NO_AUTHENTICATOR = /Two-factor sign-in is required for this application/;

/**
 * Fills whatever the SSO asks for until the browser is back where `done(url)` says, and reports what was
 * asked. `person.auth` is the authenticator, if the person has one.
 */
async function answerSso(page, person, done) {
  const asked = { password: false, code: false, refused: false };
  const email = page.locator('input[name="email"]');
  const code = page.locator('input[name="code"]');
  for (let round = 0; round < 10; round++) {
    if (done(page.url())) return asked;
    await Promise.race([
      email.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => null),
      code.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => null),
      page.waitForURL((u) => done(u.toString()), { timeout: 20_000 }).catch(() => null),
    ]);
    if (done(page.url())) return asked;
    if (
      await page
        .getByText(REFUSED_NO_AUTHENTICATOR)
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      asked.refused = true;
      return asked;
    }
    if (await code.isVisible().catch(() => false)) {
      asked.code = true;
      if (!person.auth) return asked;
      await code.fill(await person.auth.code());
      await page.locator('button[type="submit"]').click();
      await Promise.race([
        code.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => null),
        page.waitForURL((u) => done(u.toString()), { timeout: 15_000 }).catch(() => null),
      ]);
      continue;
    }
    if (await email.isVisible().catch(() => false)) {
      asked.password = true;
      // Typed before React takes over, a controlled input is reset: wait for the form to say it is live.
      await page
        .locator('form[data-hydrated="true"]')
        .waitFor({ timeout: 30_000 })
        .catch(() => null);
      await email.fill(person.email);
      await page.locator('input[name="password"]').fill(PASSWORD);
      await page.locator('button[type="submit"]').click();
      await Promise.race([
        email.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => null),
        page
          .getByText(REFUSED_NO_AUTHENTICATOR)
          .first()
          .waitFor({ timeout: 15_000 })
          .catch(() => null),
        page.waitForURL((u) => done(u.toString()), { timeout: 15_000 }).catch(() => null),
      ]);
    }
  }
  return asked;
}

const onPortal = (url) => /\/portal(\/|$|\?)(?!login)/.test(url) && !/\/portal\/login/.test(url);
async function portalSignIn(page, person) {
  for (let attempt = 0; attempt < 3 && !onPortal(page.url()); attempt++) {
    await page.goto(`${SSO}/portal/login`);
    await answerSso(page, person, onPortal);
  }
  expect(
    onPortal(page.url()),
    `${person.email} could not sign in to the SSO portal (at ${page.url()})`,
  );
}

/** The SSO console's API, as a signed-in administrator. */
class SsoAdmin {
  constructor(context) {
    this.api = context.request;
  }
  async user(email) {
    const list = await (
      await this.api.get(`${SSO}/api/v1/admin/users?q=${encodeURIComponent(email)}`)
    ).json();
    const found = list?.data?.users?.find((u) => u.email === email);
    expect(
      found,
      `the SSO has no person ${email} (run "npm run db:seed:qa-admin" in the SSO backend)`,
    );
    const detail = await (await this.api.get(`${SSO}/api/v1/admin/users/${found.id}`)).json();
    return { id: found.id, isActive: found.is_active ?? found.isActive, csrf: detail.data.csrf };
  }
  async resetTwoFactor(email) {
    const u = await this.user(email);
    const res = await this.api.post(`${SSO}/api/v1/admin/users/${u.id}/mfa-reset`, {
      data: { csrf: u.csrf },
    });
    expect(
      [200, 400, 404].includes(res.status()),
      `two-factor reset of ${email} answered ${res.status()}`,
    );
  }
  async setActive(email, active) {
    const u = await this.user(email);
    if (Boolean(u.isActive) === active) return;
    const res = await this.api.post(`${SSO}/api/v1/admin/users/${u.id}/toggle-active`, {
      data: { csrf: u.csrf },
    });
    expect(res.ok(), `changing ${email} to active=${active} answered ${res.status()}`);
  }
  async setDccRoles(email, roles) {
    const u = await this.user(email);
    const res = await this.api.put(
      `${SSO}/api/v1/admin/app-roles/dcc/users/${encodeURIComponent(email)}`,
      {
        data: { roles, csrf: u.csrf },
      },
    );
    expect(
      res.ok(),
      `setting DCC application roles of ${email} answered ${res.status()}: ${await res.text()}`,
    );
  }
  async setting(key) {
    const all = await (await this.api.get(`${SSO}/api/v1/admin/settings`)).json();
    const flat = JSON.stringify(all);
    const groups = all?.data?.groups ?? all?.data ?? [];
    for (const g of Array.isArray(groups) ? groups : Object.values(groups)) {
      for (const s of g?.settings ?? [])
        if (s.key === key) return { value: s.value, csrf: all.data.csrf };
    }
    throw new Error(
      `setting ${key} not found in the SSO console answer (${flat.slice(0, 120)}...)`,
    );
  }
  async setSetting(key, value) {
    const { csrf } = await this.setting(key);
    const res = await this.api.put(`${SSO}/api/v1/admin/settings/${key}`, {
      data: { value, csrf },
    });
    expect(
      res.ok(),
      `changing ${key} answered ${res.status()}: ${(await res.text()).slice(0, 160)}`,
    );
  }
}

async function enrolAuthenticator(browser, person) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await portalSignIn(page, person);
    await page.goto(`${SSO}/portal/security`);
    await page.getByRole('button', { name: 'Set up two-factor sign-in' }).click();
    const secret = (await page.locator('code.admin-code').first().innerText()).trim();
    expect(/^[A-Z2-7]{16,}$/.test(secret), 'the SSO did not show a setup key');
    person.auth = new Authenticator(secret);
    await page.getByLabel('6-digit code').fill(await person.auth.code());
    await page.getByRole('button', { name: 'Turn on two-factor sign-in' }).click();
    await page
      .getByRole('heading', { name: 'Save your recovery codes' })
      .waitFor({ timeout: 20_000 });
    await page.getByLabel('I have saved these codes').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText(/Two-factor sign-in is/).waitFor({ timeout: 20_000 });
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------
// DCC in the browser
// ---------------------------------------------------------------------------------------------------------
const backOnDcc = (url) => url.startsWith(`${DCC}/`) && !url.includes('/api/auth/');
async function dccSignIn(page, person, start = `${DCC}/`) {
  await page.goto(start);
  if (start === `${DCC}/`) {
    // Already signed in (the page greets the person): nothing to ask.
    const link = page.getByRole('link', { name: /Sign in with Kerchanshe SSO/ });
    const hello = page.getByRole('heading', { name: /^Hello,/ });
    await Promise.race([
      link.waitFor({ timeout: 20_000 }),
      hello.waitFor({ timeout: 20_000 }),
    ]).catch(() => null);
    if (await hello.isVisible().catch(() => false))
      return { password: false, code: false, refused: false };
    await link.click();
  }
  const asked = await answerSso(page, person, backOnDcc);
  return asked;
}
const me = async (page) => {
  const res = await page.request.get(`${DCC}/api/me`);
  return { status: res.status(), body: await res.json().catch(() => null) };
};
/** A request made by the page itself, like the web app does (same origin, the browser adds Origin). */
const fromPage = (page, method, path, body) =>
  page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [method, path, body ?? null],
  );
async function until(what, seconds, probe) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${what}: did not happen within ${seconds} seconds`);
    await sleep(500);
  }
}

// ---------------------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------------------
const startedAt = new Date().toISOString();
const browser = await chromium.launch({
  channel: env.BROWSER_CHANNEL ?? 'msedge',
  headless: env.HEADED !== '1',
});

async function ssoDownOnly() {
  await check(
    '10',
    'With the SSO stopped, pressing sign in returns to DCC with a message, not an error page',
    async () => {
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${DCC}/`);
      await page.getByRole('link', { name: /Sign in with Kerchanshe SSO/ }).click();
      await page.waitForURL(/error=signin_unavailable/, { timeout: 30_000 });
      const alert = await page.getByRole('alert').first().innerText();
      expect(/Sign-in could not be completed/.test(alert), `unexpected message: ${alert}`);
      return `landed on ${page.url().replace(DCC, '')}; the page says "${alert.trim()}"`;
    },
  );
}

async function fullRun() {
  await db.connect();
  const admin = { email: PEOPLE.admin };
  const second = { email: PEOPLE.second };
  const noMfa = { email: PEOPLE.noMfa };
  const adminContext = await browser.newContext();
  const sso = new SsoAdmin(adminContext);
  let platform = null; // a connection to the development SSO database, only for test 4
  let requiredAppsBefore = null;
  let company = null;
  /** Puts the SSO's two-factor list back exactly as it was, and waits until the SSO has re-read it. */
  const restoreRequiredApps = async () => {
    if (!platform || !requiredAppsBefore) return;
    await platform.query(
      `update idp_settings set value = $1::jsonb where key = 'mfa.requiredApps'`,
      [JSON.stringify(requiredAppsBefore)],
    );
    const now = (
      await platform.query(`select value from idp_settings where key = 'mfa.requiredApps'`)
    ).rows[0];
    expect(now.value.includes('dcc'), 'the SSO setting was not put back');
    requiredAppsBefore = null;
    await platform.end().catch(() => null);
    await sleep(12_000);
  };

  try {
    // ----- preparation -----------------------------------------------------------------------------------
    await portalSignIn(await adminContext.newPage(), { email: PEOPLE.ssoAdmin });
    for (const p of [admin, second, noMfa]) {
      await sso.setActive(p.email, true);
      await sso.resetTwoFactor(p.email);
    }
    await sso.setDccRoles(admin.email, ['dcc-group-admin']);
    await sso.setDccRoles(second.email, []);
    await sso.setDccRoles(noMfa.email, []);
    await sql(
      `delete from memberships where user_id in (select id from users where email = any($1)) and source <> 'idp'`,
      [[admin.email, second.email, noMfa.email]],
    );
    await sql(
      `delete from sessions where user_id in (select id from users where email = any($1))`,
      [[admin.email, second.email, noMfa.email]],
    );
    await enrolAuthenticator(browser, admin);
    await enrolAuthenticator(browser, second);
    console.log(
      `prepared: ${admin.email} and ${second.email} have an authenticator; ${noMfa.email} has none\n`,
    );

    const c1 = await browser.newContext();
    const p1 = await c1.newPage();
    const c2 = await browser.newContext();
    const p2 = await c2.newPage();
    let callbackUrl = null;
    p1.on('request', (r) => {
      if (r.url().includes('/api/auth/callback?')) callbackUrl = r.url();
    });

    // ----- a new person: signed in, no role yet ----------------------------------------------------------
    await check(
      '1b',
      'A new person signs in with password and code and is told they have no role yet',
      async () => {
        const asked = await dccSignIn(p2, second);
        expect(asked.password && asked.code, `the SSO asked: ${JSON.stringify(asked)}`);
        const who = await me(p2);
        expect(
          who.status === 200 && who.body.user.email === second.email,
          `/api/me answered ${who.status}`,
        );
        expect(who.body.memberships.length === 0, 'the new person already has a role');
        await p2
          .getByText('a DCC administrator has not given you a role yet')
          .waitFor({ timeout: 10_000 });
        return 'SSO asked for password and code; /api/me has no memberships; the page says so';
      },
    );

    // ----- 1: sign in with two factors -------------------------------------------------------------------
    await check('1', 'Sign in as a person with an authenticator app', async () => {
      const asked = await dccSignIn(p1, admin);
      expect(asked.password && asked.code, `the SSO asked: ${JSON.stringify(asked)}`);
      const who = await me(p1);
      expect(
        who.status === 200 && who.body.user.email === admin.email,
        `/api/me answered ${who.status}`,
      );
      expect(
        who.body.memberships.some((m) => m.role === 'group_admin' && m.companyId === null),
        'the SSO application role did not make the person a group administrator',
      );
      const events = await auditOf(admin.email, 'auth.login', startedAt);
      expect(events.length >= 1, 'no auth.login audit event');
      await p1.getByRole('heading', { name: /^Hello,/ }).waitFor({ timeout: 10_000 });
      return `SSO asked for password and code; DCC opened; /api/me shows ${admin.email} as group administrator; auth.login is in the audit trail`;
    });

    await check(
      'K1',
      'The session is stored with the key file, and remembers when the person signed in',
      async () => {
        const rows = await sql(
          `select id_token_enc, authenticated_at from sessions s join users u on u.id = s.user_id where u.email = $1`,
          [admin.email],
        );
        expect(rows.length === 1, `expected one session, found ${rows.length}`);
        const [version, keyId] = String(rows[0].id_token_enc).split('.');
        const age = (Date.now() - new Date(rows[0].authenticated_at).getTime()) / 1000;
        expect(
          rows[0].authenticated_at && age < 300,
          `authenticated_at is ${rows[0].authenticated_at}`,
        );
        if (env.SECRETS_PROVIDER === 'key-file')
          expect(
            version === 'v2' && /^k\d{8}/.test(keyId),
            `the stored token starts with ${version}.${keyId}`,
          );
        return `stored identity token: format ${version}, key ${keyId}; authenticated_at ${Math.round(age)} s ago (from the SSO's auth_time)`;
      },
    );

    // ----- 9: nothing in the browser but one HttpOnly cookie ---------------------------------------------
    await check(
      '9',
      'After sign-in the browser holds one HttpOnly cookie and nothing in storage',
      async () => {
        const storage = await p1.evaluate(() => ({
          local: localStorage.length,
          session: sessionStorage.length,
        }));
        expect(storage.local === 0 && storage.session === 0, `storage: ${JSON.stringify(storage)}`);
        const cookies = (await c1.cookies(DCC)).filter((c) => c.domain === 'localhost');
        const sid = cookies.find((c) => c.name === 'dcc_sid');
        expect(
          sid && sid.httpOnly && sid.sameSite === 'Lax',
          `session cookie: ${JSON.stringify(sid)}`,
        );
        const visible = await p1.evaluate(() => document.cookie);
        expect(!visible.includes('dcc_sid'), 'the page can read the session cookie');
        const who = await me(p1);
        expect(!/token/i.test(JSON.stringify(who.body)), '/api/me contains a token');
        return 'localStorage 0, sessionStorage 0; dcc_sid is HttpOnly, SameSite=Lax and invisible to the page; no token in /api/me';
      },
    );

    // ----- first role by email ---------------------------------------------------------------------------
    await check(
      '1c',
      'The administrator gives the new person their first role by email',
      async () => {
        const companies = await fromPage(p1, 'GET', '/api/companies');
        company = companies.body.find((c) => c.slug === 'demo-company-a') ?? companies.body[0];
        expect(company, 'no company in DCC (run "npm run db:seed")');
        const people = await fromPage(p1, 'GET', '/api/users');
        expect(
          !people.body.some((u) => u.email === second.email),
          'the new person was already visible',
        );
        const granted = await fromPage(p1, 'POST', '/api/memberships', {
          email: second.email,
          companyId: company.id,
          role: 'content_creator',
        });
        expect(
          granted.status === 201,
          `grant answered ${granted.status}: ${JSON.stringify(granted.body)}`,
        );
        await p2.reload();
        await p2.getByText(/Content creator/i).waitFor({ timeout: 10_000 });
        return `not in the people list before; POST /api/memberships with the email answered 201; their page now shows the role in ${company.name}`;
      },
    );

    // ----- 2: sign in again for a sensitive action -------------------------------------------------------
    await check(
      '2',
      `After ${REAUTH_MINUTES} min, granting a role asks to sign in again; then it works`,
      async () => {
        const waitSeconds = REAUTH_MINUTES * 60 + 10;
        console.log(
          `          (waiting ${waitSeconds} s for the sign-in to become too old, keeping the session in use)`,
        );
        for (let waited = 0; waited < waitSeconds; waited += 20) {
          await sleep(Math.min(20, waitSeconds - waited) * 1000);
          expect((await me(p1)).status === 200, 'the session ended while waiting');
        }
        const body = { email: second.email, companyId: company.id, role: 'content_reviewer' };
        const stale = await fromPage(p1, 'POST', '/api/memberships', body);
        expect(
          stale.status === 401 && stale.body?.code === 'reauth_required',
          `expected 401 reauth_required, got ${stale.status} ${JSON.stringify(stale.body)}`,
        );
        const ordinary = await fromPage(p1, 'GET', '/api/users');
        expect(ordinary.status === 200, 'an ordinary request was refused too');
        const before = new Date().toISOString();
        const asked = await dccSignIn(p1, admin, `${DCC}/api/auth/login?reauth=1&returnTo=/`);
        expect(
          asked.password && asked.code,
          `the SSO did not make the person prove who they are again: ${JSON.stringify(asked)}`,
        );
        const again = await fromPage(p1, 'POST', '/api/memberships', body);
        expect(again.status === 201, `after signing in again the grant answered ${again.status}`);
        const events = await auditOf(admin.email, 'auth.login', before);
        expect(
          events[0]?.details?.reauthentication === true,
          'the audit event does not say it was a re-authentication',
        );
        const sessions = await sql(`select count(*)::int as n from sessions where user_id = $1`, [
          await dccUserId(admin.email),
        ]);
        expect(
          sessions[0].n === 1,
          `the replaced session was not ended (${sessions[0].n} sessions)`,
        );
        return `401 with code reauth_required while ordinary requests kept working; the SSO asked for password and code again although its own session was alive; the grant then answered 201; audit says reauthentication; the old session was ended`;
      },
    );

    // ----- 11: a callback works once ---------------------------------------------------------------------
    await check(
      '11',
      'The callback address of a finished sign-in does nothing a second time',
      async () => {
        expect(callbackUrl, 'no callback address was seen');
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(callbackUrl);
        expect(/error=signin_failed/.test(page.url()), `landed on ${page.url()}`);
        expect((await me(page)).status === 401, 'the replay produced a session');
        await context.close();
        return 'replayed in a fresh browser: back on DCC with "sign-in could not be completed", no session';
      },
    );

    // ----- 3: no authenticator, no entry -----------------------------------------------------------------
    await check('3', 'A person without an authenticator app is refused at the SSO', async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const asked = await dccSignIn(page, noMfa);
      expect(asked.refused, `the SSO did not refuse: ${JSON.stringify(asked)} at ${page.url()}`);
      expect((await me(page)).status === 401, 'a DCC session exists');
      const text = (await page.getByText(REFUSED_NO_AUTHENTICATOR).first().innerText()).trim();
      await context.close();
      return `the SSO said: "${text}"; no DCC session`;
    });

    // ----- 4: DCC's own lock ------------------------------------------------------------------------------
    await check(
      '4',
      'With DCC taken off the SSO two-factor list, DCC itself refuses a password-only sign-in',
      async () => {
        // Only the SSO's platform administrator may change this setting in the console, and that account is
        // the owner's. On a DEVELOPMENT SSO the test changes the stored row directly and puts the exact row
        // back; the SSO re-reads its settings every 10 seconds.
        expect(
          env.SSO_DEV_DATABASE_URL,
          'skipped: set SSO_DEV_DATABASE_URL (the development SSO database) to run it',
        );
        platform = new pg.Client({ connectionString: env.SSO_DEV_DATABASE_URL });
        await platform.connect();
        const row = (
          await platform.query(`select value from idp_settings where key = 'mfa.requiredApps'`)
        ).rows[0];
        requiredAppsBefore = row?.value;
        expect(
          Array.isArray(requiredAppsBefore) && requiredAppsBefore.includes('dcc'),
          'dcc was not on the list',
        );
        await platform.query(
          `update idp_settings set value = $1::jsonb where key = 'mfa.requiredApps'`,
          [JSON.stringify(requiredAppsBefore.filter((a) => a !== 'dcc'))],
        );
        await sleep(12_000);
        const before = new Date().toISOString();
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
          const asked = await dccSignIn(page, noMfa);
          expect(
            asked.password && !asked.code && !asked.refused,
            `the SSO asked: ${JSON.stringify(asked)}`,
          );
          expect(/error=signin_failed/.test(page.url()), `landed on ${page.url()}`);
          expect((await me(page)).status === 401, 'DCC let a password-only sign-in in');
          const failed = await sql(
            `select details from audit_events where action = 'auth.login_failed' and occurred_at >= $1 order by id desc limit 1`,
            [before],
          );
          expect(
            failed[0]?.details?.reason === 'mfa_required',
            `audit reason: ${JSON.stringify(failed[0]?.details)}`,
          );
        } finally {
          await restoreRequiredApps();
          await context.close();
        }
        return 'the SSO let the password-only sign-in through; DCC refused it (audit reason mfa_required), no session; the SSO setting was put back';
      },
    );

    // ----- 6: disabled in the SSO, out of DCC at once ----------------------------------------------------
    await check('6', 'Disabling a signed-in person in the SSO ends their DCC session', async () => {
      expect((await me(p2)).status === 200, 'the second person was not signed in');
      const before = new Date().toISOString();
      const t0 = Date.now();
      await sso.setActive(second.email, false);
      await until('the session to end', 15, async () => (await me(p2)).status === 401);
      const seconds = ((Date.now() - t0) / 1000).toFixed(1);
      const events = await sql(
        `select details from audit_events where action = 'auth.backchannel_logout' and occurred_at >= $1`,
        [before],
      );
      await sso.setActive(second.email, true);
      expect(events.length >= 1, 'no auth.backchannel_logout audit event');
      return `session ended ${seconds} s after the click in the SSO console; auth.backchannel_logout is in the audit trail`;
    });

    // ----- 8: idle timeout -------------------------------------------------------------------------------
    await check(
      '8',
      `A session left untouched for more than ${IDLE_MINUTES} min ends`,
      async () => {
        expect((await me(p1)).status === 200, 'the administrator was not signed in');
        const waitSeconds = IDLE_MINUTES * 60 + 15;
        console.log(`          (waiting ${waitSeconds} s without touching the session)`);
        await sleep(waitSeconds * 1000);
        const who = await me(p1);
        expect(who.status === 401, `after the wait /api/me answered ${who.status}`);
        return `after ${waitSeconds} s idle: 401 "${who.body?.message}"`;
      },
    );

    // ----- 5: sign out ------------------------------------------------------------------------------------
    await check('5', 'Signing out of DCC signs out of the SSO too', async () => {
      await dccSignIn(p1, admin);
      expect((await me(p1)).status === 200, 'could not sign in before signing out');
      await p1.goto(`${DCC}/`);
      const button = p1.getByRole('button', { name: 'Sign out' });
      await button.waitFor({ state: 'visible', timeout: 20_000 });
      // The address the SSO is sent to is read from the browser's own navigation after the click.
      const toSso = p1.waitForRequest(
        (r) => r.isNavigationRequest() && /session\/end|logout/.test(r.url()),
        {
          timeout: 30_000,
        },
      );
      // A development page can be visible a moment before it reacts to clicks. One click only: a second
      // one would start a second sign-out.
      await sleep(3_000);
      await button.click({ timeout: 10_000 });
      const logoutUrl = await toSso.then((r) => r.url()).catch(() => null);
      expect(logoutUrl, 'pressing "Sign out" did not send the browser to the SSO');
      expect(
        /id_token_hint=/.test(logoutUrl),
        'the SSO sign-out address carries no identity token hint',
      );
      // First the browser really leaves for the SSO (the request above is only its start); the SSO may ask
      // to confirm; then it sends the browser back to DCC.
      const trail = [];
      const note = (r) => {
        if (r.request().isNavigationRequest())
          trail.push(`${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`);
      };
      p1.on('response', note);
      const consoleLines = [];
      p1.on('console', (m) => {
        if (m.type() === 'error') consoleLines.push(m.text().slice(0, 200));
      });
      await p1.waitForURL((u) => u.toString().startsWith(SSO), { timeout: 30_000 });
      // The SSO asks "Sign out of Kerchanshe SSO?": the person presses its Sign out button, once.
      const confirm = p1.locator('button[name="logout"][value="yes"]').first();
      await confirm.waitFor({ state: 'visible', timeout: 20_000 });
      await confirm.click();
      await p1.waitForURL((u) => backOnDcc(u.toString()), { timeout: 15_000 }).catch(() => null);
      p1.off('response', note);
      const returned = backOnDcc(p1.url());
      const blockedByPolicy = consoleLines.some((l) => /form-action/.test(l));
      const sameOrigin = new URL(SSO).origin === new URL(DCC).origin;
      // Where DCC and the SSO share one address (mirror, production) the browser must come back. Where they
      // do not (development), the SSO page's own policy (form-action 'self') stops the return trip: that is a
      // known limit of the SSO, reported, and everything else must still hold.
      expect(
        returned || (!sameOrigin && blockedByPolicy),
        `after sign-out the browser stayed at ${p1.url().split('?')[0]}; pages: ${trail.join(' -> ')}; browser errors: ${consoleLines.join(' | ') || 'none'}`,
      );
      expect((await me(p1)).status === 401, 'the DCC session survived');
      // Is the person still signed in at the SSO? Start a new sign-in: the SSO must ask for the password again.
      const again = await dccSignIn(p1, admin);
      expect(
        again.password && again.code,
        `the SSO session SURVIVED the DCC sign-out: a new sign-in was asked ${JSON.stringify(again)}`,
      );
      return `DCC session ended; the stored identity token was decrypted for the SSO (id_token_hint present); the person confirmed on the SSO page; the SSO session ended (the next sign-in asked for password and code again); ${
        returned
          ? 'the browser came back to DCC'
          : "the browser did NOT come back to DCC: the SSO page's form-action policy blocks a return to another address (DCC and the SSO are on different addresses here; on one address, as in production, this does not apply)"
      }`;
    });

    // ----- 7: the application role is removed -------------------------------------------------------------
    await check(
      '7',
      'Removing the DCC administrator role in the SSO ends the session and the role',
      async () => {
        await dccSignIn(p1, admin);
        expect(
          (await me(p1)).body.memberships.some((m) => m.role === 'group_admin'),
          'not a group administrator',
        );
        const before = new Date().toISOString();
        await sso.setDccRoles(admin.email, []);
        await until('the session to end', 15, async () => (await me(p1)).status === 401);
        await dccSignIn(p1, admin);
        const who = await me(p1);
        expect(who.status === 200, `signing in again answered ${who.status}`);
        expect(
          !who.body.memberships.some((m) => m.role === 'group_admin'),
          'still a group administrator',
        );
        const events = await auditOf(admin.email, 'access.group_admin_revoked_by_idp', before);
        expect(events.length === 1, 'no access.group_admin_revoked_by_idp audit event');
        return 'session ended at once; after signing in again the person is no longer group administrator; the revocation is in the audit trail';
      },
    );
  } finally {
    // ----- put the SSO's test people back as they were ---------------------------------------------------
    try {
      await restoreRequiredApps();
      for (const p of [admin, second, noMfa]) {
        await sso.setActive(p.email, true);
        await sso.resetTwoFactor(p.email);
        await sso.setDccRoles(p.email, []);
      }
      console.log('\ncleaned up: test people active, two-factor off, no DCC application role');
    } catch (error) {
      console.error(`\nCLEAN-UP FAILED, check the SSO test people by hand: ${error.message}`);
    }
    await db.end().catch(() => null);
  }
}

try {
  if (env.ONLY === 'sso-down') await ssoDownOnly();
  else await fullRun();
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.status === 'fail');
console.log(
  `\n${results.length - failed.length} of ${results.length} passed${failed.length ? `; FAILED: ${failed.map((r) => r.id).join(', ')}` : ''}`,
);
if (env.RESULTS_FILE)
  writeFileSync(
    env.RESULTS_FILE,
    `${JSON.stringify({ startedAt, sso: SSO, dcc: DCC, reauthMinutes: REAUTH_MINUTES, idleMinutes: IDLE_MINUTES, results }, null, 2)}\n`,
  );
process.exit(failed.length ? 1 : 0);

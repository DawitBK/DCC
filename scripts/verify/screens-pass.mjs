/**
 * Screens pass: every role x every screen x desktop/phone x light/dark, checking for console errors, failed requests,
 * content-security-policy violations, horizontal scroll and accessibility (axe, WCAG 2.0/2.1/2.2 A and AA).
 * Development only (writes sessions straight into the dev database, like `npm run dev:session`).
 *
 *   PLAYWRIGHT_FROM=<folder with node_modules/playwright-core> AXE_FROM=<folder with node_modules/axe-core>  *     [BASE=http://localhost:7917] [ROLES=group_admin,publisher] [ROUTES=dashboard,content] [THEMES=light] [PW_CHANNEL=msedge]  *     node scripts/verify/screens-pass.mjs
 *
 * Neither playwright-core nor axe-core is a dependency of this repository: point the two variables at any checkout on
 * this PC that has them (the SSO and DMS frontends do). Needs the dev database container (default dcc-dev-postgres-1,
 * override with DCC_DEV_DB_CONTAINER) and a running dev backend and frontend. Writes screens-pass.json next to the
 * working directory. Every browser context gets its own fresh session: reusing one session across many page loads
 * lost the session part-way in a long run (cause not found), which looked like a screen failing.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const need = (name) => {
  if (!process.env[name]) {
    console.error('Set ' + name + ' (see the header of this file).');
    process.exit(2);
  }
  return process.env[name];
};
const { chromium } = createRequire(resolve(need('PLAYWRIGHT_FROM'), 'package.json'))(
  'playwright-core',
);
const axeSource = readFileSync(
  resolve(need('AXE_FROM'), 'node_modules/axe-core/axe.min.js'),
  'utf8',
);
const CONTAINER = process.env.DCC_DEV_DB_CONTAINER || 'dcc-dev-postgres-1';
const BASE = process.env.BASE || 'http://localhost:7917';
const routes = (
  process.env.ROUTES ||
  'dashboard,my-work,notifications,create-content,content,approvals,calendar,publishing,inbox,analytics,social-accounts,companies,engine,governance,roles,approval-policies,incidents,security,audit,profile,help'
).split(',');
const ALL_ROLES = [
  'group_admin',
  'group_cto',
  'security_admin',
  'group_marketing',
  'auditor',
  'company_admin',
  'company_executive',
  'company_marketing_manager',
  'content_creator',
  'content_reviewer',
  'publisher',
];
const roles = process.env.ROLES ? process.env.ROLES.split(',') : ALL_ROLES;
import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
const fresh = (role) => {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  execSync(
    `docker exec ${CONTAINER} psql -U postgres -d dcc_dev -At -c "insert into sessions (id_hash, user_id, expires_at, authenticated_at) select '${hash}', id, now() + interval '4 hours', now() from users where email='qa.${role}@example.test'"`,
    { stdio: 'ignore' },
  );
  return token;
};
// PW_CHANNEL=msedge (or chrome) uses the browser installed on this PC, when Playwright's own download does not match.
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
});
const results = [];
for (const role of roles) {
  for (const theme of (process.env.THEMES || 'light,dark').split(',')) {
    for (const [label, vp] of [
      ['desktop', { width: 1280, height: 900 }],
      ['phone', { width: 360, height: 740 }],
    ]) {
      const ctx = await browser.newContext({ viewport: vp });
      await ctx.addCookies([{ name: 'dcc_sid', value: fresh(role), url: BASE }]);
      await ctx.addInitScript((t) => {
        try {
          localStorage.setItem('dcc.theme', t);
        } catch {}
      }, theme);
      for (const r of routes) {
        const page = await ctx.newPage();
        const issues = [];
        page.on('console', (m) => {
          if (['error', 'warning'].includes(m.type()))
            issues.push(`console.${m.type()}: ${m.text().slice(0, 140)}`);
        });
        page.on('pageerror', (e) => issues.push(`pageerror: ${e.message.slice(0, 140)}`));
        page.on('response', (rs) => {
          if (rs.status() >= 400 && !rs.url().includes('favicon'))
            issues.push(
              `http ${rs.status()} ${rs.request().method()} ${rs.url().replace(BASE, '').slice(0, 70)}`,
            );
        });
        await page.addInitScript(() =>
          document.addEventListener('securitypolicyviolation', (e) =>
            console.error('CSP ' + e.violatedDirective + ' ' + e.blockedURI),
          ),
        );
        let status = 0,
          body = '',
          overflow = false,
          axe = [];
        try {
          const resp = await page.goto(`${BASE}/${r}`, {
            waitUntil: 'networkidle',
            timeout: 60000,
          });
          status = resp?.status() ?? 0;
          await page.waitForTimeout(500);
          body = (
            await page
              .locator('main')
              .first()
              .innerText()
              .catch(() => 'NO MAIN')
          )
            .replace(/\s+/g, ' ')
            .slice(0, 160);
          overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          );
          await page.evaluate(axeSource);
          axe = await page.evaluate(async () =>
            (
              await window.axe.run(document, {
                runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
              })
            ).violations.map(
              (v) => `${v.id}(${v.nodes.length}): ${v.nodes[0]?.target?.join(' ').slice(0, 80)}`,
            ),
          );
        } catch (e) {
          issues.push('nav: ' + e.message.slice(0, 120));
        }
        results.push({
          role,
          theme,
          label,
          route: r,
          status,
          landed: page.url().replace(BASE, ''),
          overflow,
          issues: [...new Set(issues)],
          axe,
          body,
        });
        await page.close();
      }
      await ctx.close();
    }
  }
}
await browser.close();
writeFileSync('screens-pass.json', JSON.stringify(results, null, 1));
const bad = results.filter(
  (x) =>
    x.issues.length ||
    x.overflow ||
    x.axe.length ||
    x.status >= 400 ||
    /something went wrong|sign in|not found/i.test(x.body),
);
console.log(`checked ${results.length} page loads; ${bad.length} with findings`);
const seen = new Map();
for (const b of bad) {
  const key = `${b.route} | ${b.overflow ? 'OVERFLOW ' : ''}${b.issues.join(';')} ${b.axe.join(';')} | status ${b.status} | ${/something went wrong|sign in/i.test(b.body) ? b.body.slice(0, 60) : ''}`;
  (seen.get(key) ?? seen.set(key, []).get(key)).push(`${b.role}/${b.label}/${b.theme}`);
}
for (const [k, v] of seen)
  console.log(
    `- ${k}\n    ${v.slice(0, 5).join(', ')}${v.length > 5 ? ' +' + (v.length - 5) : ''}`,
  );

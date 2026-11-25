#!/usr/bin/env node
/**
 * Three-layer parity check: does the web app represent everything the backend can do?
 *
 *   1. ROUTES       every backend route (method + path) must be used by some screen (or be on the short, explained
 *                   list of routes that are not for people: health probes, metrics, the sign-in redirects).
 *   2. PERMISSIONS  every permission in `@dcc/contracts` must decide something in the web app (a menu entry, a
 *                   `can(...)`, a control): a permission no screen ever looks at is a capability nobody can reach.
 *   3. FIELDS       every field of every `...Dto` response type should be read somewhere in the web app. A field
 *                   the API returns and no screen shows is listed as a warning (a name is matched anywhere in the
 *                   front end, so this under-reports rather than over-reports).
 *
 * Exit code 1 when a route or a permission is not represented. Warnings alone do not fail.
 *
 *   node scripts/verify/parity-check.mjs            print the report
 *   node scripts/verify/parity-check.mjs --write    also write docs/design/PARITY-REPORT.md
 *
 * Read-only: it only reads source files.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const write = process.argv.includes('--write');

const walk = (dir, accept) =>
  readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name === '.next' || name.startsWith('.next'))
      return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, accept) : accept(full) ? [full] : [];
  });
const read = (file) => readFileSync(file, 'utf8');

// ---------------------------------------------------------------------------------------------------------
// Routes not meant for a person at a screen, each with the reason.
// ---------------------------------------------------------------------------------------------------------
/**
 * Routes a screen really calls, but with a path the literal matcher below cannot see (a path built in two steps, a
 * ternary, a helper that adds the verb). Each was checked by hand on 2026-11-25. The proof is a list of
 * [file under portal/frontend/src, text that must still be in it]: if the code moves or changes, the route is
 * reported as NOT USED again, so this list cannot go stale silently.
 */
const COMPOSED_PATHS = {
  'POST /approval-requests/:id/approve': [
    ['components/work/approval-panel.tsx', '`/approval-requests/${request.id}/${kind}`'],
    ['components/work/approval-panel.tsx', "'review' | 'approve' | 'reject'"],
  ],
  'POST /approval-requests/:id/reject': [
    ['components/work/approval-panel.tsx', '`/approval-requests/${request.id}/${kind}`'],
    ['components/work/approval-panel.tsx', "'review' | 'approve' | 'reject'"],
  ],
  'POST /approval-requests/:id/review': [
    ['components/work/approval-panel.tsx', '`/approval-requests/${request.id}/${kind}`'],
    ['components/work/approval-panel.tsx', "'review' | 'approve' | 'reject'"],
  ],
  'POST /companies': [
    ['app/screens/companies-forms.tsx', "? '/companies'"],
    ['app/screens/companies-forms.tsx', "isNew ? 'POST' : 'PATCH'"],
  ],
  'PATCH /companies/:companyId': [
    ['app/screens/companies-forms.tsx', '`/companies/${editing.company.id}`'],
    ['app/screens/companies-forms.tsx', "isNew ? 'POST' : 'PATCH'"],
  ],
  'POST /companies/:companyId/brands': [
    ['app/screens/companies-forms.tsx', '`/companies/${editing.company.id}/brands`'],
    ['app/screens/companies-forms.tsx', "isNew ? 'POST' : 'PATCH'"],
  ],
  'POST /media': [
    ['components/media-picker.tsx', 'apiUpload<ContentMediaDto>('],
    ['components/media-picker.tsx', '`/media${queryString({ companyId })}`'],
  ],
  'GET /media/:id/file': [
    ['lib/media.ts', 'withBasePath(media.url)'], // the API sends the file address in `url`
  ],
  'POST /social-accounts/:id/assignments': [
    [
      'app/screens/accounts-detail.tsx',
      'const base = `/social-accounts/${account.id}/assignments`;',
    ],
    ['app/screens/accounts-detail.tsx', "apiSend('POST', base, checked.data)"],
  ],
  'DELETE /social-accounts/:id/assignments/:userId': [
    ['app/screens/accounts-detail.tsx', "apiSend('DELETE', `${base}/${removing.userId}`)"],
  ],
  'PATCH /social-accounts/:id/backup-admin': [
    ['app/screens/accounts-detail.tsx', '`${base}/backup-admin`'],
    ['app/screens/accounts-detail.tsx', "method: 'PATCH' = 'PATCH'"],
  ],
  'PATCH /social-accounts/:id/status': [
    ['app/screens/accounts-detail.tsx', "apiSend('PATCH', `${base}/status`"],
  ],
  'PATCH /social-accounts/:id': [
    ['app/screens/accounts-detail.tsx', 'const base = `/social-accounts/${account.id}`;'],
    ['app/screens/accounts-detail.tsx', 'validate(UpdateSocialAccountRequest, patch), base)'],
  ],
};
const composedProven = (key) => {
  const proof = COMPOSED_PATHS[key];
  if (!proof) return false;
  return proof.every(([file, needle]) => {
    try {
      return read(join(root, 'portal/frontend/src', file)).includes(needle);
    } catch {
      return false;
    }
  });
};

const NOT_FOR_SCREENS = {
  'GET /metrics': 'scraped by the monitoring system with a bearer token',
  'GET /health/live': 'probe for the process supervisor',
  'GET /health/ready': 'probe for the process supervisor',
  'GET /auth/login': 'a browser redirect to the SSO, started by a plain link',
  'GET /auth/callback': 'the SSO sends the browser back here',
  'POST /auth/logout': 'the sign-out button posts to the web app’s own sign-out route',
  'POST /auth/backchannel-logout': 'called by the SSO server to server, never by a browser',
};

// ---------------------------------------------------------------------------------------------------------
// 1. Backend routes
// ---------------------------------------------------------------------------------------------------------
const controllers = walk(join(root, 'portal/backend/src'), (f) => f.endsWith('.controller.ts'));
const routes = [];
for (const file of controllers) {
  const text = read(file);
  const base = /@Controller\(\s*(?:'([^']*)')?\s*\)/.exec(text)?.[1] ?? '';
  const block =
    /((?:[ \t]*@[A-Za-z]+\((?:[^()]|\([^()]*\))*\)[ \t]*\n)+)[ \t]*(?:async\s+)?[A-Za-z_]+\s*\(/g;
  let m;
  while ((m = block.exec(text))) {
    const decorators = m[1];
    const verb = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/.exec(decorators);
    if (!verb) continue;
    const permission = /@RequirePermission\('([^']+)'\)/.exec(decorators)?.[1] ?? null;
    routes.push({
      method: verb[1].toUpperCase(),
      path: `/${[base, verb[2]].filter(Boolean).join('/')}`.replace(/\/+/g, '/'),
      permission,
      recentAuth: decorators.includes('@RequireRecentAuth'),
      file: relative(root, file).replace(/\\/g, '/'),
    });
  }
}

// ---------------------------------------------------------------------------------------------------------
// The web app's source
// ---------------------------------------------------------------------------------------------------------
const frontFiles = walk(join(root, 'portal/frontend/src'), (f) => /\.(ts|tsx)$/.test(f));
const front = frontFiles.map((file) => ({ file, text: read(file) }));
const frontText = front.map((f) => f.text).join('\n');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `/companies/:companyId/brands` -> a pattern for the literal as the screens write it (`/companies/${id}/brands`). */
function pathPattern(path) {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith(':') ? '(?:\\$\\{[^}]*\\}|[^/\'"`\\s?]+)' : escape(segment),
    );
  // Written as '/x/...', `${base}/api/x/...` or '/api/x/...': the base path and the /api prefix do not matter.
  return new RegExp(`['"\`}](?:/api)?/${parts.join('/')}(?=[?'"\`$\\s]|\\$\\{)`, 'g');
}

function routeUsed(route) {
  const pattern = pathPattern(route.path);
  for (const { text } of front) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text))) {
      if (route.method === 'GET') return true;
      // A change is used when the verb is named next to the path (apiSend('POST', ...), method: 'POST').
      const window = text.slice(Math.max(0, m.index - 160), m.index + 260);
      if (window.includes(`'${route.method}'`) || window.includes(`"${route.method}"`)) return true;
    }
  }
  return false;
}

const routeRows = routes
  .sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method))
  .map((route) => {
    const key = `${route.method} ${route.path}`;
    const excused = NOT_FOR_SCREENS[key];
    return {
      ...route,
      key,
      excused,
      used: excused ? null : routeUsed(route) || composedProven(key),
      composed: !excused && !routeUsed(route) && composedProven(key),
    };
  });
const missingRoutes = routeRows.filter((r) => r.used === false);

// ---------------------------------------------------------------------------------------------------------
// 2. Permissions
// ---------------------------------------------------------------------------------------------------------
const permissionsSource = read(join(root, 'portal/contracts/src/permissions.ts'));
const permissionList = [
  ...(
    /export const PERMISSIONS = \[([\s\S]*?)\] as const/.exec(permissionsSource)?.[1] ?? ''
  ).matchAll(/'([a-z_]+\.[a-z_]+)'/g),
].map((m) => m[1]);
const frontForPermissions = front
  .filter((f) => !f.file.endsWith('permissions-ui.ts'))
  .map((f) => f.text)
  .join('\n');
// A permission the table grants that no backend route asks for: reserved, and the roles page says so.
const RESERVED_PERMISSIONS = {
  'security.manage':
    'held by the Group CTO and the security administrator; no backend route asks for it yet (BACKLOG)',
};
const permissionRows = permissionList.map((permission) => ({
  permission,
  reserved: RESERVED_PERMISSIONS[permission] ?? null,
  used:
    Boolean(RESERVED_PERMISSIONS[permission]) ||
    new RegExp(`['"]${escape(permission)}['"]`).test(frontForPermissions),
}));
const missingPermissions = permissionRows.filter((p) => !p.used);

// ---------------------------------------------------------------------------------------------------------
// 3. Response fields
// ---------------------------------------------------------------------------------------------------------
const apiSource = read(join(root, 'portal/contracts/src/api.ts'));
const fields = [];
for (const m of apiSource.matchAll(/export interface (\w+Dto)\b[^{]*\{([\s\S]*?)\n\}/g)) {
  for (const f of m[2].matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm))
    fields.push({ dto: m[1], field: f[1] });
}
const frontNoLabelTables = frontText;
const fieldRows = fields.map(({ dto, field }) => ({
  dto,
  field,
  used: new RegExp(`(?:\\.|\\b|\\?\\.)${escape(field)}\\b`).test(frontNoLabelTables),
}));
const unusedFields = fieldRows.filter((f) => !f.used);

// ---------------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------------
const lines = [];
const out = (line = '') => lines.push(line);
out('# Parity report: backend capability against the web app');
out();
out(
  `Generated by \`node scripts/verify/parity-check.mjs --write\` (read-only; it only reads source). Do not edit by hand: run the script.`,
);
out();
out(`| Layer | Checked | Not represented |`);
out(`| ----- | ------: | --------------: |`);
out(
  `| Backend routes used by a screen | ${routeRows.filter((r) => !r.excused).length} | **${missingRoutes.length}** |`,
);
out(
  `| Permissions that decide something in the web app | ${permissionRows.length} | **${missingPermissions.length}** |`,
);
out(
  `| Response fields (\`...Dto\`) read by a screen | ${fieldRows.length} | ${unusedFields.length} (warnings) |`,
);
out();
if (missingRoutes.length) {
  out('## Routes no screen uses (FAIL)');
  out();
  for (const r of missingRoutes)
    out(`- \`${r.key}\` (${r.permission ?? 'no permission'}) in ${r.file}`);
  out();
}
if (missingPermissions.length) {
  out('## Permissions no screen looks at (FAIL)');
  out();
  for (const p of missingPermissions) out(`- \`${p.permission}\``);
  out();
}
out('## Every backend route and where the web app uses it');
out();
out('| Route | Permission | Sign in again | Web app |');
out('| ----- | ---------- | :-----------: | ------- |');
for (const r of routeRows)
  out(
    `| \`${r.key}\` | ${r.permission ? `\`${r.permission}\`` : 'any signed-in person'} | ${r.recentAuth ? 'yes' : ''} | ${
      r.excused
        ? `not for a screen: ${r.excused}`
        : r.composed
          ? 'used (path built in code, checked by hand)'
          : r.used
            ? 'used'
            : '**NOT USED**'
    } |`,
  );
out();
if (unusedFields.length) {
  out('## Response fields no screen reads (warnings: check each is meant to be internal)');
  out();
  const byDto = new Map();
  for (const f of unusedFields) byDto.set(f.dto, [...(byDto.get(f.dto) ?? []), f.field]);
  for (const [dto, names] of byDto) out(`- \`${dto}\`: ${names.map((n) => `\`${n}\``).join(', ')}`);
  out();
}
const report = lines.join('\n');
console.log(report);
if (write) writeFileSync(join(root, 'docs/design/PARITY-REPORT.md'), `${report}\n`);
process.exit(missingRoutes.length || missingPermissions.length ? 1 : 0);

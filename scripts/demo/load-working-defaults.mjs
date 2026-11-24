/**
 * Enters the WORKING DEFAULTS adopted on 2026-11-25 (owner instruction; every guess is recorded) into a running
 * DCC, through the API, as signed-in administrators:
 *
 *   - the six content categories of the proposal's approval matrix and the company default,
 *   - the approval rule of each category for the chosen companies (docs/requirements/APPROVAL-AND-PUBLISHING-POLICY.md),
 *   - the seven group-default incident categories with their playbooks, read from
 *     docs/security/INCIDENT-PLAYBOOKS.md (that page is the single source of the text).
 *
 * Recovery contacts are never loaded: they are real people's details.
 *
 * Needs two sessions of people who may do it (made with `npm run dev:session`, or taken from a real sign-in):
 *   DCC_ADMIN_SESSION     a group administrator           (content categories, approval rules)
 *   DCC_SECURITY_SESSION  the Group CTO or a security admin (incident categories)
 * A session made by `dev:session` counts as freshly signed in for 15 minutes, which the approval rules need.
 *
 *   dev:     DCC_ADMIN_SESSION=... DCC_SECURITY_SESSION=... node scripts/run-with-env.mjs .env        node scripts/demo/load-working-defaults.mjs [company-slug ...]
 *   mirror:  DCC_ADMIN_SESSION=... DCC_SECURITY_SESSION=... node scripts/run-with-env.mjs .env.mirror node scripts/demo/load-working-defaults.mjs [company-slug ...]
 *
 * With no company slug the rules go to every company the administrator can see. Safe to run twice: a category,
 * a rule or a playbook that already exists is left exactly as it is (a person may have changed it since).
 * It never deletes anything.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const say = (line) => process.stdout.write(`${line}\n`);
const stop = (line) => {
  process.stderr.write(`${line}\n`);
  process.exit(1);
};

const root = resolve(import.meta.dirname, '..', '..');
const apiBase = `${process.env.DCC_API_INTERNAL_URL ?? ''}/api`;
const origin = process.env.DCC_WEB_ORIGIN;
const admin = process.env.DCC_ADMIN_SESSION;
const security = process.env.DCC_SECURITY_SESSION;
if (!process.env.DCC_API_INTERNAL_URL || !origin)
  stop(
    'Run it through scripts/run-with-env.mjs so DCC_API_INTERNAL_URL and DCC_WEB_ORIGIN are set.',
  );
if (!admin || !security)
  stop('Set DCC_ADMIN_SESSION and DCC_SECURITY_SESSION (see the top of this file).');

async function api(session, method, path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      cookie: `dcc_sid=${session}`,
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${data?.message ?? text}`);
  return data;
}

// The matrix. Roles are DCC roles (portal/contracts/src/roles.ts); counts are different people.
// Keep this in step with section 2 of APPROVAL-AND-PUBLISHING-POLICY.md.
const CATEGORIES = [
  ['routine', 'Routine operational update', 1, ['company_marketing_manager']],
  [
    'campaign',
    'Product and promotional campaign',
    1,
    ['company_marketing_manager', 'group_marketing'],
  ],
  ['group-announcement', 'Group-level announcement', 1, ['group_marketing']],
  ['financial', 'Financial and investor-related', 2, ['company_executive', 'group_marketing']],
  ['crisis', 'Crisis, legal or reputational', 1, ['company_executive']],
  ['sensitive', 'Sensitive corporate statement', 2, ['company_executive', 'group_marketing']],
];
const DEFAULT_RULE = {
  requiredApprovals: 1,
  approverRoles: ['company_marketing_manager', 'company_executive'],
};

/** `### key: Name` then a numbered list, in section 2 of the playbook page. */
function readPlaybooks() {
  const text = readFileSync(resolve(root, 'docs/security/INCIDENT-PLAYBOOKS.md'), 'utf8');
  const section = text.split(/^## 2\. /m)[1]?.split(/^## 3\. /m)[0];
  if (!section) stop('INCIDENT-PLAYBOOKS.md has no section 2.');
  const out = [];
  for (const block of section.split(/^### /m).slice(1)) {
    const [head, ...lines] = block.split('\n');
    const match = /^([a-z0-9-]+): (.+)$/.exec(head.trim());
    if (!match) stop(`Cannot read the heading "${head}".`);
    const steps = lines.map((l) => /^\d+\.\s+(.+)$/.exec(l.trim())?.[1]).filter(Boolean);
    if (!steps.length) stop(`The playbook ${match[1]} has no steps.`);
    out.push({ key: match[1], name: match[2].trim(), steps });
  }
  return out;
}

async function main() {
  const summary = { categories: 0, rules: 0, incidentCategories: 0, playbooks: 0 };

  // Content categories (group level), as the group administrator.
  const existing = await api(admin, 'GET', '/content-categories');
  const categoryId = {};
  for (const [key, name] of CATEGORIES) {
    const found = existing.find((c) => c.key === key);
    if (found) categoryId[key] = found.id;
    else {
      categoryId[key] = (await api(admin, 'POST', '/content-categories', { key, name })).id;
      summary.categories += 1;
    }
  }

  // Approval rules, one per category plus the default, for each chosen company.
  const wanted = process.argv.slice(2);
  const companies = (await api(admin, 'GET', '/companies')).filter(
    (c) => c.status !== 'archived' && (wanted.length === 0 || wanted.includes(c.slug)),
  );
  if (wanted.length && companies.length !== wanted.length)
    stop(
      `Not every company was found: asked for ${wanted.join(', ')}, found ${companies.map((c) => c.slug).join(', ')}.`,
    );
  for (const company of companies) {
    const rules = await api(admin, 'GET', `/approval-policies?companyId=${company.id}`);
    const has = (id) =>
      rules.some((r) => r.companyId === company.id && (r.categoryId ?? null) === id);
    const todo = [
      [null, DEFAULT_RULE],
      ...CATEGORIES.map(([key, , requiredApprovals, approverRoles]) => [
        categoryId[key],
        { requiredApprovals, approverRoles },
      ]),
    ];
    for (const [id, rule] of todo) {
      if (has(id)) continue;
      await api(admin, 'PUT', '/approval-policies', {
        companyId: company.id,
        categoryId: id,
        ...rule,
      });
      summary.rules += 1;
    }
  }

  // Incident categories (group default) with playbooks, as the security role.
  const groupCategories = (await api(security, 'GET', '/incident-categories')).filter(
    (c) => c.companyId === null,
  );
  for (const book of readPlaybooks()) {
    const playbook = { title: `${book.name} (working default)`, steps: book.steps };
    const found = groupCategories.find((c) => c.key === book.key);
    if (!found) {
      await api(security, 'POST', '/incident-categories', {
        key: book.key,
        name: book.name,
        playbook,
      });
      summary.incidentCategories += 1;
      summary.playbooks += 1;
    } else if (!found.playbook) {
      await api(security, 'PATCH', `/incident-categories/${found.id}`, { playbook });
      summary.playbooks += 1;
    }
  }

  say(
    `done: ${summary.categories} content categories, ${summary.rules} approval rules (${companies.length} companies), ` +
      `${summary.incidentCategories} incident categories, ${summary.playbooks} playbooks entered; what already existed was left alone`,
  );
}

main().catch((error) => stop(String(error.message ?? error)));

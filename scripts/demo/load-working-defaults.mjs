/**
 * Enters the WORKING DEFAULTS adopted on 2026-11-25 (owner instruction; every guess is recorded) into a running
 * DCC, through the API, as signed-in administrators:
 *
 *   - the twelve content categories of the approval matrix (the proposal's six and the Marketing team's Round 2 additions) and the company default,
 *   - the approval rule of each category for the chosen companies (docs/requirements/APPROVAL-AND-PUBLISHING-POLICY.md):
 *     how many different approvers, which roles, and (since Round 2) the time limit and how it counts, and (since Round 3)
 *     who may remove or correct a published post of that category (sheet C2 column I),
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
 * `--update` (anywhere after the command) overwrites the rule of a category that already has one, to bring a company to a newer matrix
 * (that is how a company loaded before Round 2 gets its time limits). `--dry-run` prints the matrix that would be entered and stops:
 * it needs no sessions and calls nothing. It never deletes anything.
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
const cliArgs = process.argv.slice(2);
const dryRun = cliArgs.includes('--dry-run');
if (!dryRun && (!process.env.DCC_API_INTERNAL_URL || !origin))
  stop(
    'Run it through scripts/run-with-env.mjs so DCC_API_INTERNAL_URL and DCC_WEB_ORIGIN are set.',
  );
if (!dryRun && (!admin || !security))
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
// Keep this in step with section 2 of APPROVAL-AND-PUBLISHING-POLICY.md (version 0.2, the Marketing team's Round 2).
// The business roles DCC does not have (Head of Finance, Head of Legal, HR manager, Business Unit Head, Executive Office)
// are entered as the company executive (assumptions AP-10 and AP-14).
const CATEGORIES = [
  ['routine', 'Routine operational update', 1, ['company_marketing_manager']],
  [
    'ads-and-offers',
    'Ads and offers',
    2, // the team: 1, or 2 when a price, discount or claim is stated; a rule cannot be conditional (AP-11)
    ['company_marketing_manager', 'company_executive'],
  ],
  ['partner-mention', 'Partner or customer mention', 1, ['company_marketing_manager']],
  [
    'campaign',
    'Product and promotional campaign',
    2, // the Marketing & Communications Manager and the Business Unit Head
    ['company_marketing_manager', 'company_executive'],
  ],
  ['group-announcement', 'Group-level announcement', 2, ['group_marketing', 'company_executive']],
  ['executive', 'Executive or leadership', 2, ['company_executive']],
  ['financial', 'Financial and investor-related', 2, ['company_executive', 'group_marketing']],
  ['legal', 'Legal and regulatory', 2, ['company_executive', 'group_marketing']],
  ['hr-recruitment', 'HR and recruitment', 1, ['company_marketing_manager', 'company_executive']],
  [
    'crisis',
    'Crisis, legal or reputational',
    2, // the team: 2, with one senior person allowed alone in an emergency. The emergency approval exists since Round 2, so AP-12 is lifted
    ['company_executive'],
  ],
  ['sensitive', 'Sensitive corporate statement', 2, ['company_executive', 'group_marketing']],
];

// Time limits (Round 2, section 4 of the policy page): "24 / 48 office hours" is a WORKING clock (Monday to Saturday 08:30
// to 17:30, counted from submission); Crisis is 1 hour on a CONTINUOUS clock (24 hours a day). The limit drives the reminders
// and the escalation ladder only: nothing is ever approved or published by it. A category not listed here has the default.
const WORKING_24 = { timeLimitHours: 24, clock: 'working' };
const WORKING_48 = { timeLimitHours: 48, clock: 'working' };
const LIMITS = {
  campaign: WORKING_48,
  executive: WORKING_48,
  financial: WORKING_48,
  legal: WORKING_48,
  sensitive: WORKING_48,
  crisis: { timeLimitHours: 1, clock: 'continuous' },
};

// Who may remove or correct a published post (Round 3, sheet C2 column I "who may delete or correct"). The team's roles are entered as
// the DCC roles of the approval matrix above: the Digital Marketing Manager is company_marketing_manager; the Marketing & Communications
// Manager, CEO, senior management and the heads are company_executive (and group_marketing at group level); "authorised admin" is
// company_admin. (group_admin, the other "authorised admin", is covered by the default when a rule names nobody; a rule that names
// roles, like these, means exactly those roles, so the company's own administrator is entered and the Group administrator is not.)
// A category not listed here is "other": the executive and the administrator.
const MARKETING_REMOVERS = ['company_marketing_manager', 'company_admin'];
const SENIOR_REMOVERS = ['company_executive', 'group_marketing', 'company_admin'];
const OTHER_REMOVERS = ['company_executive', 'company_admin'];
const REMOVERS = {
  routine: MARKETING_REMOVERS,
  'ads-and-offers': MARKETING_REMOVERS,
  'partner-mention': MARKETING_REMOVERS,
  campaign: MARKETING_REMOVERS,
  'group-announcement': SENIOR_REMOVERS,
  executive: SENIOR_REMOVERS,
  crisis: SENIOR_REMOVERS,
  sensitive: SENIOR_REMOVERS, // "political": the policy page's "Political or sensitive"
  financial: OTHER_REMOVERS,
  legal: OTHER_REMOVERS,
  'hr-recruitment': OTHER_REMOVERS,
};
const DEFAULT_RULE = {
  requiredApprovals: 1,
  approverRoles: ['company_marketing_manager', 'company_executive'],
  ...WORKING_24,
  removeRoles: OTHER_REMOVERS,
};

/** The rules to enter, as [category key or null for the company default, rule]. */
const RULES = [
  [null, DEFAULT_RULE],
  ...CATEGORIES.map(([key, , requiredApprovals, approverRoles]) => [
    key,
    {
      requiredApprovals,
      approverRoles,
      ...(LIMITS[key] ?? WORKING_24),
      removeRoles: REMOVERS[key] ?? OTHER_REMOVERS,
    },
  ]),
];

if (dryRun) {
  say('Dry run: nothing is called. The rules that would be entered for each company:');
  for (const [key, rule] of RULES) {
    say(
      `  ${(key ?? '(company default)').padEnd(20)} ${rule.requiredApprovals} approver${
        rule.requiredApprovals === 1 ? ' ' : 's'
      }  ${String(rule.timeLimitHours).padStart(2)} h ${rule.clock.padEnd(10)}  ${rule.approverRoles.join(', ')}`,
    );
    say(`      may remove or correct a published post: ${rule.removeRoles.join(', ')}`);
  }
  process.exit(0);
}

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
  const summary = {
    categories: 0,
    rules: 0,
    withoutLimit: 0,
    withoutRemoveRoles: 0,
    incidentCategories: 0,
    playbooks: 0,
  };

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
  // `--update` overwrites the rule of a category that already has one; without it, what exists is left alone.
  const update = cliArgs.includes('--update');
  const wanted = cliArgs.filter((a) => a !== '--update');
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
    const todo = RULES.map(([key, rule]) => [key === null ? null : categoryId[key], rule]);
    for (const [id, rule] of todo) {
      if (has(id) && !update) {
        // A rule entered before Round 2 has no time limit: count it so it is reported, never overwrite it
        // (a person may have changed it since).
        const kept = rules.find((r) => r.companyId === company.id && (r.categoryId ?? null) === id);
        if (kept && kept.timeLimitHours == null) summary.withoutLimit += 1;
        if (kept && (kept.removeRoles ?? []).length === 0) summary.withoutRemoveRoles += 1;
        continue;
      }
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
      `${summary.incidentCategories} incident categories, ${summary.playbooks} playbooks entered; what already existed was ${update ? 'overwritten where it has a rule (--update)' : 'left alone'}`,
  );
  if (summary.withoutLimit)
    say(
      `note: ${summary.withoutLimit} existing rules have no time limit (entered before Round 2) and were left as they are; run again with --update to give them the limits.`,
    );
  if (summary.withoutRemoveRoles)
    say(
      `note: ${summary.withoutRemoveRoles} existing rules name nobody for removing or correcting a published post, so the default applies (the roles that approve, plus the administrators); run again with --update to enter the matrix's roles.`,
    );
}

main().catch((error) => stop(String(error.message ?? error)));

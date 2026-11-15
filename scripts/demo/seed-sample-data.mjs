/**
 * Sample data for a demonstration: companies, brands, people in every role, registered accounts linked to the
 * practice channels, content categories, approval rules, and content in every state (draft, in review,
 * approved, published, scheduled, rejected, waiting for a second approver), a freeze and incidents.
 *
 * Everything except the people is made THROUGH THE API, as the sample people, so approvals, publications
 * and the audit trail are real records made by the real rules. The people are not real: their addresses end
 * in `@sample.dcc.example` and they cannot sign in through the SSO.
 *
 * Never for production. Run it against a RUNNING backend with practice channels (ENGINE_PROVIDER=fake, or
 * postiz with DCC_ENGINE_PRACTICE_CHANNELS=true):
 *
 *   dev:     I_UNDERSTAND_THIS_SEEDS_SAMPLE_DATA=dcc_dev  node scripts/run-with-env.mjs .env        node scripts/demo/seed-sample-data.mjs
 *   mirror:  I_UNDERSTAND_THIS_SEEDS_SAMPLE_DATA=dccprod  node scripts/run-with-env.mjs .env.mirror node scripts/demo/seed-sample-data.mjs
 *
 * Safe to run twice: what exists is kept; content is added only to a company that has none.
 */
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const say = (line) => process.stdout.write(`${line}\n`);
const stop = (line) => {
  process.stderr.write(`${line}\n`);
  process.exit(1);
};

const environment = process.env.DCC_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
const ownerUrl = process.env.DCC_MIGRATE_DATABASE_URL;
const apiBase = `${process.env.DCC_API_INTERNAL_URL ?? ''}/api`;
const origin = process.env.DCC_WEB_ORIGIN;
if (!ownerUrl || !process.env.DCC_API_INTERNAL_URL || !origin)
  stop(
    'Run it through scripts/run-with-env.mjs so the settings are loaded (see the top of this file).',
  );
if (environment === 'production') stop('Refused: sample data never goes into production.');
const database = new URL(ownerUrl).pathname.slice(1);
if (process.env.I_UNDERSTAND_THIS_SEEDS_SAMPLE_DATA !== database)
  stop(
    `Refused: set I_UNDERSTAND_THIS_SEEDS_SAMPLE_DATA=${database} to confirm the database "${database}".`,
  );

const DAY = 24 * 60 * 60 * 1000;
const COMPANIES = [
  {
    name: 'Kerchanshe Coffee',
    slug: 'kerchanshe-coffee',
    brands: [
      ['Kerchanshe Coffee Export', 'coffee-export'],
      ['Buna Qela', 'buna-qela'],
    ],
    accounts: [
      ['facebook', 'Kerchanshe Coffee', '@kerchanshecoffee', 1],
      ['instagram', 'Kerchanshe Coffee', '@kerchanshe.coffee', 1],
      ['linkedin', 'Kerchanshe Coffee', 'kerchanshe-coffee', 1],
      ['tiktok', 'Kerchanshe Coffee', '@kerchanshecoffee', 1],
    ],
    topic: 'coffee',
  },
  {
    name: 'Kerchanshe Equipment',
    slug: 'kerchanshe-equipment',
    brands: [['Kerchanshe Equipment', 'equipment']],
    accounts: [
      ['facebook', 'Kerchanshe Equipment', '@kerchansheequipment', 2],
      ['linkedin', 'Kerchanshe Equipment', 'kerchanshe-equipment', 2],
      ['youtube', 'Kerchanshe Equipment', '@kerchansheequipment', 1],
      ['x', 'Kerchanshe Equipment', '@kerchanshe_eq', 1],
    ],
    topic: 'equipment',
  },
  {
    name: 'Buna Pen and Plate Factory',
    slug: 'buna-pen-and-plate',
    brands: [
      ['Buna Pen', 'buna-pen'],
      ['Buna Plate', 'buna-plate'],
    ],
    accounts: [
      ['instagram', 'Buna Pen and Plate', '@bunapenplate', 2],
      ['tiktok', 'Buna Pen and Plate', '@bunapenplate', 2],
      ['youtube', 'Buna Pen and Plate', '@bunapenplate', 2],
      ['x', 'Buna Pen and Plate', '@bunapenplate', 2],
    ],
    topic: 'factory',
  },
];
const COMPANY_ROLES = [
  ['admin', 'company_admin', 'Company administrator'],
  ['executive', 'company_executive', 'Executive'],
  ['manager', 'company_marketing_manager', 'Marketing manager'],
  ['creator', 'content_creator', 'Content creator'],
  ['reviewer', 'content_reviewer', 'Content reviewer'],
  ['publisher', 'publisher', 'Publisher'],
];
const GROUP_ROLES = [
  ['group.admin', 'group_admin', 'Sample Group administrator'],
  ['group.cto', 'group_cto', 'Sample Group CTO'],
  ['group.security', 'security_admin', 'Sample Security administrator'],
  ['group.marketing', 'group_marketing', 'Sample Group marketing'],
  ['group.auditor', 'auditor', 'Sample Auditor'],
];
const CATEGORIES = [
  ['routine', 'Routine post'],
  ['campaign', 'Campaign'],
  ['group-announcement', 'Group announcement'],
  ['financial', 'Financial statement'],
  ['crisis', 'Crisis communication'],
];
const TEXT = {
  coffee: {
    draft:
      'Harvest season has started in Guji. First pictures from the washing stations this week.',
    review: 'Campaign: meet the farmers behind your cup. A new story every Friday this month.',
    ready:
      'Our export team will be at the specialty coffee fair next month. Come and taste the new lots.',
    published: 'Thank you to every farmer and partner for a record export year.',
    published2: 'New washed Yirgacheffe lots are now available for sampling.',
    scheduled: 'Friday story: Almaz has farmed coffee in Bule Hora for twenty years.',
    scheduled2: 'Reminder: our office is closed on the public holiday next week.',
    rejected: 'Best coffee in the world, guaranteed, nobody else comes close!!!',
    crisis:
      'Statement: a shipment delay at the port affects some orders. We are contacting each customer directly.',
    financial: 'Annual results: export volume and revenue for the past year.',
  },
  equipment: {
    draft: 'The new tractor range arrives at the Addis showroom this month.',
    review: 'Campaign: free service check for every machine bought this year.',
    ready: 'Operator training starts on Monday at the Kality workshop. Register at the front desk.',
    published: 'Our service team is now available six days a week.',
    published2: 'Spare parts for all models are back in stock.',
    scheduled: 'Video: how to prepare your machine for the rainy season.',
    scheduled2: 'Showroom opening hours change from next week.',
    rejected: 'Cheapest machines in the country, competitors cannot match us.',
    crisis:
      'Safety notice: please stop using the affected hydraulic hose batch and contact our workshop.',
    financial: 'Half-year sales figures for the equipment division.',
  },
  factory: {
    draft: 'A look inside the pen production line.',
    review: 'Campaign: back to school with Buna Pen.',
    ready: 'New plate designs are now in shops in Addis Ababa and Adama.',
    published: 'We welcomed students from three schools to the factory this week.',
    published2: 'Buna Pen is now available in boxes of fifty.',
    scheduled: 'Back to school: where to find Buna Pen near you.',
    scheduled2: 'Meet the team: quality control.',
    rejected: 'Our pens never run out of ink.',
    crisis:
      'Notice: one batch of plates is being recalled as a precaution. Details for shops below.',
    financial: 'Production and sales summary for the year.',
  },
};

const db = new pg.Client({ connectionString: ownerUrl });
const sessions = new Map();

async function person(local, display, groupId, companyId, role) {
  const email = `${local}@sample.dcc.example`;
  const user = await db.query(
    `insert into users (idp_subject, email, display_name, last_login_at) values ($1, $2, $3, now())
     on conflict (idp_subject) do update set display_name = excluded.display_name returning id`,
    [`sample:${email}`, email, display],
  );
  const id = user.rows[0].id;
  await db.query(
    `insert into memberships (user_id, group_id, company_id, role, source) values ($1, $2, $3, $4, 'dcc')
     on conflict (user_id, group_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), role) do nothing`,
    [id, groupId, companyId, role],
  );
  if (!sessions.has(local)) {
    const token = randomBytes(32).toString('base64url');
    await db.query(
      `insert into sessions (id_hash, user_id, expires_at) values ($1, $2, now() + interval '2 hours')`,
      [createHash('sha256').update(token).digest('hex'), id],
    );
    sessions.set(local, { id, cookie: `dcc_sid=${token}` });
  }
  return id;
}

async function api(who, method, path, body, tolerate = []) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      cookie: sessions.get(who).cookie,
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok && !tolerate.includes(response.status))
    throw new Error(`${method} ${path} as ${who}: ${response.status} ${data?.message ?? text}`);
  return { status: response.status, data };
}

async function main() {
  await db.connect();
  const slug = process.env.DCC_DEFAULT_GROUP_SLUG ?? 'kerchanshe';
  const group = await db.query(
    `insert into groups (name, slug) values ('Kerchanshe Group', $1)
     on conflict (slug) do update set slug = excluded.slug returning id`,
    [slug],
  );
  const groupId = group.rows[0].id;
  for (const [local, role, display] of GROUP_ROLES)
    await person(local, display, groupId, null, role);
  const G = 'group.admin';

  // categories
  const existingCategories = (await api(G, 'GET', '/content-categories')).data;
  const category = {};
  for (const [key, name] of CATEGORIES) {
    const found = existingCategories.find((c) => c.key === key);
    category[key] = found
      ? found.id
      : (await api(G, 'POST', '/content-categories', { key, name })).data.id;
  }

  const report = [];
  for (const c of COMPANIES) {
    const companies = (await api(G, 'GET', '/companies')).data;
    const company =
      companies.find((x) => x.slug === c.slug) ??
      (await api(G, 'POST', '/companies', { name: c.name, slug: c.slug })).data;
    const who = (role) => `${c.slug}.${role}`;
    const ids = {};
    for (const [local, role, title] of COMPANY_ROLES)
      ids[local] = await person(who(local), `${title}, ${c.name}`, groupId, company.id, role);

    const brands = (await api(G, 'GET', `/companies/${company.id}/brands`)).data;
    const brandIds = [];
    for (const [name, brandSlug] of c.brands) {
      const found = brands.find((b) => b.slug === brandSlug);
      brandIds.push(
        found
          ? found.id
          : (await api(G, 'POST', `/companies/${company.id}/brands`, { name, slug: brandSlug }))
              .data.id,
      );
    }

    const allAccounts = (await api(G, 'GET', '/social-accounts')).data;
    const accounts = [];
    for (const [platform, displayName, handle, n] of c.accounts) {
      let account = allAccounts.find(
        (a) => a.companyId === company.id && a.platform === platform && a.handle === handle,
      );
      if (!account)
        account = (
          await api(G, 'POST', '/social-accounts', {
            companyId: company.id,
            brandId: brandIds[0],
            platform,
            displayName,
            handle,
            ownerUserId: ids.manager,
            backupAdminUserId: ids.admin,
          })
        ).data;
      if (!account.engineChannelId)
        await api(
          G,
          'PATCH',
          `/social-accounts/${account.id}/engine-channel`,
          { engineChannelId: `fake-${platform}-${n}` },
          [409],
        );
      accounts.push(account.id);
    }

    // approval rules: a crisis statement needs two people; a financial statement only the executive decides
    await api(G, 'PUT', '/approval-policies', {
      companyId: company.id,
      categoryId: category.crisis,
      requiredApprovals: 2,
      approverRoles: [],
    });
    await api(G, 'PUT', '/approval-policies', {
      companyId: company.id,
      categoryId: category.financial,
      requiredApprovals: 1,
      approverRoles: ['company_executive'],
    });

    const existing = (await api(who('creator'), 'GET', '/content-items')).data;
    if (existing.some((i) => i.companyId === company.id)) {
      report.push(`${c.name}: already has content, left as it is`);
      continue;
    }
    const t = TEXT[c.topic];
    const draft = async (body, key, account = 0) =>
      (
        await api(who('creator'), 'POST', '/content-items', {
          companyId: company.id,
          brandId: brandIds[0],
          body,
          targetAccountIds: [accounts[account]],
          categoryId: category[key],
        })
      ).data;
    const submit = async (item) =>
      (await api(who('creator'), 'POST', `/content-items/${item.id}/submit`)).data;
    const approve = (request, by = 'manager') =>
      api(who(by), 'POST', `/approval-requests/${request.id}/approve`, {});
    const approved = async (body, key, account = 0) => {
      const item = await draft(body, key, account);
      await approve(await submit(item));
      return item;
    };
    const publish = (item, account, scheduledAt) =>
      api(who('publisher'), 'POST', `/content-items/${item.id}/publish`, {
        socialAccountId: accounts[account],
        ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
      });

    await draft(t.draft, 'routine');
    const inReview = await submit(await draft(t.review, 'campaign', 1));
    await api(who('reviewer'), 'POST', `/approval-requests/${inReview.id}/review`, {
      comment: 'Please check the dates with the campaign plan before this goes out.',
    });
    await approved(t.ready, 'routine', 2);
    await publish(await approved(t.published, 'routine', 0), 0);
    await publish(await approved(t.published2, 'campaign', 1), 1);
    await publish(await approved(t.scheduled, 'campaign', 0), 0, new Date(Date.now() + 2 * DAY));
    await publish(await approved(t.scheduled2, 'routine', 2), 2, new Date(Date.now() + 6 * DAY));
    const rejected = await submit(await draft(t.rejected, 'routine', 3));
    await api(who('manager'), 'POST', `/approval-requests/${rejected.id}/reject`, {
      comment: 'This claim cannot be supported. Please rewrite without superlatives.',
    });
    await approve(await submit(await draft(t.crisis, 'crisis', 0))); // one of two
    await submit(await draft(t.financial, 'financial', 2)); // waits for the executive
    report.push(`${c.name}: 2 brand(s), 4 accounts, 6 people, 10 content items`);
  }

  // a freeze and two incidents, so those screens are not empty
  const [coffee, equipment, factory] = COMPANIES;
  const accountsOf = async (c) => {
    const company = (await api(G, 'GET', '/companies')).data.find((x) => x.slug === c.slug);
    const accounts = (await api(G, 'GET', '/social-accounts')).data.filter(
      (a) => a.companyId === company.id,
    );
    return { company, accounts };
  };
  const incidents = (await api('group.security', 'GET', '/incidents')).data;
  if (incidents.length === 0) {
    const f = await accountsOf(factory);
    const frozen = f.accounts.find((a) => a.platform === 'x');
    await api(`${factory.slug}.executive`, 'POST', '/publishing-freezes', {
      companyId: f.company.id,
      socialAccountId: frozen.id,
      reason: 'Unusual posts seen on this account. Frozen while it is checked.',
    });
    const first = (
      await api(`${factory.slug}.executive`, 'POST', '/incidents', {
        companyId: f.company.id,
        socialAccountId: frozen.id,
        title: 'Posts on X that nobody in the team wrote',
        description:
          'Two posts appeared on Saturday night. Publishing through DCC is frozen for this account.',
        severity: 'high',
      })
    ).data;
    await api('group.security', 'PATCH', `/incidents/${first.id}`, { status: 'investigating' });
    const e = await accountsOf(equipment);
    const second = (
      await api(`${equipment.slug}.executive`, 'POST', '/incidents', {
        companyId: e.company.id,
        title: 'A former employee was still an administrator of the Facebook page',
        description: 'Found during the account review. Access removed the same day.',
        severity: 'medium',
      })
    ).data;
    await api('group.security', 'PATCH', `/incidents/${second.id}`, { status: 'resolved' });
    report.push('1 freeze, 2 incidents');
  }
  void coffee;

  await db.query(
    `delete from sessions where user_id in (select id from users where idp_subject like 'sample:%')`,
  );
  say(`Sample data ready in "${database}":`);
  for (const line of report) say(`  ${line}`);
  say(
    '  5 content categories, approval rules for crisis (two people) and financial (executive only)',
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.end().catch(() => undefined));

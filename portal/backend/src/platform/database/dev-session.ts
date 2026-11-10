import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { GROUP_ONLY_ROLES, isRole, roleAllowedAtScope } from '@dcc/contracts';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
if (!process.env.DCC_ENV_FILE && existsSync(resolve(root, '.env')))
  process.loadEnvFile(resolve(root, '.env'));

/**
 * DEVELOPMENT ONLY. Gives a developer a signed-in browser session on their OWN computer without the SSO, so screens
 * can be built and tried for every role. It writes to the local database only, refuses to run for anything but a
 * local development setup, and is not part of the product.
 *
 *   npm run dev:session -- <email> [role] [company-slug]
 *   npm run dev:session -- rahel@example.test content_creator demo-company-a
 */
const environment = process.env.DCC_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
const url = process.env.DCC_MIGRATE_DATABASE_URL;
if (environment !== 'development' || !url) {
  console.error(
    'Refused: this only works for a local development setup (.env with DCC_MIGRATE_DATABASE_URL).',
  );
  process.exit(1);
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  console.error(`Refused: the database host is "${host}", not this computer.`);
  process.exit(1);
}

const [email, roleArg = 'group_admin', companySlug = 'demo-company-a'] = process.argv.slice(2);
if (!email || !email.includes('@') || !isRole(roleArg)) {
  console.error('Usage: npm run dev:session -- <email> [role] [company-slug]');
  console.error(
    'Roles: group_admin, group_cto, security_admin, group_marketing, auditor, company_admin,',
  );
  console.error(
    '       company_executive, company_marketing_manager, content_creator, content_reviewer, publisher',
  );
  process.exit(1);
}
const role = roleArg;
const scope = (GROUP_ONLY_ROLES as readonly string[]).includes(role) ? 'group' : 'company';
if (!roleAllowedAtScope(role, scope)) throw new Error('role/scope mismatch');

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('begin');
    const group = await client.query<{ id: string }>('select id from groups where slug = $1', [
      process.env.DCC_DEFAULT_GROUP_SLUG ?? 'kerchanshe',
    ]);
    if (!group.rows[0]) throw new Error('No group yet. Run: npm run db:seed');
    const groupId = group.rows[0].id;

    let companyId: string | null = null;
    if (scope === 'company') {
      const company = await client.query<{ id: string }>(
        'select id from companies where group_id = $1 and slug = $2',
        [groupId, companySlug],
      );
      if (!company.rows[0]) throw new Error(`No company "${companySlug}". Run: npm run db:seed`);
      companyId = company.rows[0].id;
    }

    const user = await client.query<{ id: string }>(
      `insert into users (idp_subject, email, display_name, last_login_at)
       values ($1, $2, $3, now())
       on conflict (idp_subject) do update set last_login_at = now() returning id`,
      [`dev:${email.toLowerCase()}`, email.toLowerCase(), email.split('@')[0]],
    );
    const userId = user.rows[0]!.id;

    await client.query(
      `insert into memberships (user_id, group_id, company_id, role, source)
       values ($1, $2, $3, $4, 'dcc')
       on conflict (user_id, group_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), role) do nothing`,
      [userId, groupId, companyId, role],
    );

    const sessionId = randomBytes(32).toString('base64url');
    await client.query(
      `insert into sessions (id_hash, user_id, expires_at) values ($1, $2, now() + interval '8 hours')`,
      [createHash('sha256').update(sessionId).digest('hex'), userId],
    );
    await client.query('commit');

    console.log(
      `\nSigned-in session created for ${email} as "${role}"${companyId ? ` in ${companySlug}` : ' (whole group)'}.\n`,
    );
    console.log('Put it in your browser (valid 8 hours; the idle timeout still applies):');
    console.log('  1. Open the frontend (for example http://localhost:7717) and press F12.');
    console.log(
      '  2. Chrome/Edge: Application tab > Cookies > the site. Firefox: Storage tab > Cookies.',
    );
    console.log(
      '  3. Add a cookie:  Name = dcc_sid   Value = the line below   Path = /   (leave the rest as it is)',
    );
    console.log('  4. Reload the page. You are signed in.\n');
    console.log(sessionId + '\n');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});

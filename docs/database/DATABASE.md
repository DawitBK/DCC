# Database

Owner: Dawit (platform tables, roles, conventions) and Hirko (domain tables). PostgreSQL 16+ (developed on 17).
Decision: [ADR-0005](../architecture/decisions/ADR-0005-kysely-sql-migrations.md).

## Roles

| Role                   | Used by                     | Can                                                                                                                                                         |
| ---------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres` (superuser) | `npm run db:bootstrap` only | create the two roles and the databases                                                                                                                      |
| `dcc_owner`            | migrations, seed, backup    | owns the schema. **Never** used by the running API                                                                                                          |
| `dcc_app`              | the running API             | read/write only what its grants allow; no superuser, no BYPASSRLS, no DDL, no DELETE on core tables, nothing on audit beyond SELECT and the audit functions |

## Databases per environment

`dcc_dev` (development), `dcc_test` (scratch, rebuilt by the test suite: **never put anything there you want to keep**), and one per
server environment. Names follow the platform convention: system id with underscores, then the environment.

## Platform tables (migration files in `apps/api/migrations`)

| Table                           | Purpose                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `groups`, `companies`, `brands` | the hierarchy; company status `active/suspended/archived`                                                                                  |
| `users`                         | people as known to the SSO (`idp_subject` unique); no passwords, no tokens                                                                 |
| `memberships`                   | role per person at group level (`company_id` null) or one company; `source` `dcc` or `idp`; role/scope rule enforced by a check constraint |
| `social_accounts`               | the registry: platform, handle, status, owner, backup admin, `engine_channel_id` (the Postiz channel). No credentials.                     |
| `account_assignments`           | who works with which account                                                                                                               |
| `sessions`, `auth_transactions` | server-side sessions (id stored as SHA-256) and in-flight logins                                                                           |
| `audit_events`                  | append-only hash chain                                                                                                                     |
| `schema_migrations`             | applied migration files with checksums                                                                                                     |

Domain tables **not yet created** (Hirko): content and versions, approval policies/levels/assignments/history,
publishing records (content id, approval version, approver, engine operation id, external post id, status, errors, times),
idempotency keys, freeze flags, incidents, notifications, report snapshots.

## Conventions

- Primary keys `uuid default gen_random_uuid()`. Timestamps `timestamptz`. Enumerations as `text` with a `check` constraint (adding a value is a new migration).
- A company-scoped table has `company_id not null references companies(id)`, RLS enabled, policies using `app_company_allowed(company_id)`, and attack tests. Child tables that must stay inside the same company use a composite foreign key `(child_fk, company_id)` like `social_accounts → brands`.
- Soft state by `status`, not deletion, for companies, brands and accounts (the runtime role has no DELETE on them on purpose).
- Migrations: `YYYYMMDDHHMM__what.sql`, plain SQL, one concern each. **Never edit an applied migration**: the runner refuses (checksum). Add a new one.
- When you change a table, update `apps/api/src/platform/database/schema.ts` in the same pull request.
- Anything that needs to run with more power than `dcc_app` (login, back-channel logout) is a small `SECURITY DEFINER` function with a pinned `search_path`, executable only by `dcc_app`, doing one job.

## Commands

```bash
npm run db:bootstrap   # roles + databases (idempotent; needs the superuser URL in .env)
npm run db:migrate     # apply new migrations as dcc_owner
npm run db:seed        # fictional demo companies (development only)
npm run db:reset       # drop and rebuild dev + test databases, migrate, seed
node scripts/db/backup.mjs        # see devops/BACKUP-AND-RECOVERY.md
```

## Seed data

`db:seed` creates the group and three clearly fictional "Demo Company A/B/C" with one demo brand and account each. There is
**no real subsidiary, brand, account or person** in any seed: those come from onboarding (docs/onboarding), loaded through the product.

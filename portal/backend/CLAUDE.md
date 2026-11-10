# portal/backend: the NestJS backend (read the root `CLAUDE.md` first; it is binding)

- `src/platform/` and `src/config/` are **Dawit's only**: login, sessions, tenant context, audit, config, health. Do not edit them. Need a change? Open an issue for Dawit.
- `src/modules/` is **Hirko's**. Copy the pattern of `src/modules/companies/`: controller (permission + zod validation), service (**all** queries in `TenantDb.run`, `authz.can` per company, **audit event in the same transaction**), tests.
- Every new company table: `company_id`, row-level security, policies, minimal grants to `dcc_app`, and **attack tests** (see `test/tenant-isolation.test.ts`).
- Migrations are in `migrations/`, named `YYYYMMDDHHMM__what.sql`. **Never edit a migration that is already merged.**
- Never publish except through `GovernedEngine`; never call Postiz directly.
- Never create your own database connection or connect as `dcc_owner`.
- Run before a pull request: `npm run lint && npm run typecheck && npm test && npm run build` (from the repo root).

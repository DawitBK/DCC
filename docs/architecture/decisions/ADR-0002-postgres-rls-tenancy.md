# ADR-0002: Company isolation by PostgreSQL row-level security

**Status:** Accepted · **Deciders:** Dawit

**Context.** The proposal requires strict separation between companies; "a company administrator never gains access to another subsidiary automatically". Application-level `WHERE company_id = ?` filters fail silently the day someone forgets one.
**Decision.** Tenant tables have RLS policies. For each request the API resolves the caller's memberships from the database and sets three transaction-local settings (`app.user_id`, `app.group_ids`, `app.company_ids`) inside one transaction (`TenantDb.run`). The runtime role is not the table owner, not a superuser and has no BYPASSRLS. No settings means no rows.
**Alternatives.** Application filters only (rejected: one mistake leaks data). One database or schema per company (rejected: migrations and reporting across companies get hard; the proposal wants group-wide views).
**Consequences.** Isolation holds even if service code is wrong, and it is tested by attacks against real PostgreSQL (`apps/api/test/tenant-isolation.test.ts`). Cost: every data access must go through `TenantDb.run`; there is a small per-request overhead; RLS is the _tenant_ boundary, while what a person may do inside a tenant (RBAC) stays in the API.
Detail: [TENANCY-AND-RLS](../../security/TENANCY-AND-RLS.md).

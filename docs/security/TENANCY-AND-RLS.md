# Tenancy and row-level security

Owner: Dawit. Code: `portal/backend/migrations/202611101010__rls_and_grants.sql`, `portal/backend/src/platform/tenancy/tenant-db.ts`.
Tests: `portal/backend/test/tenant-isolation.test.ts` (15 attacks against real PostgreSQL).

## The model

`Group → Company → Brand → Social account`. A person holds **memberships**: a role at group level
(`company_id` null, applies to every company of that group) or for one company. A company role never
reaches another company; a group-level role is explicit, stored, and bounded to its own group.

## What the database enforces

For every request the API reads the caller's memberships **from the database** (never from the browser,
never from the session) and opens one transaction that sets, transaction-locally:

| Setting           | Meaning                                               |
| ----------------- | ----------------------------------------------------- |
| `app.user_id`     | the caller                                            |
| `app.group_ids`   | groups where the caller holds a group-level role      |
| `app.company_ids` | companies where the caller holds a company-level role |

Policies use helper functions (`app_company_allowed(company_id)` etc.). With **no** settings the answer is
"no rows" (fail closed). The runtime role `dcc_app` is not a superuser, has no BYPASSRLS, owns nothing and
cannot create or drop objects; the schema is owned by `dcc_owner`, which the running API never uses.

**Pooling.** Settings are `set_config(..., is_local => true)`, so they disappear at COMMIT or ROLLBACK and
cannot leak to the next request on the same pooled connection. A test runs with a pool of size 1 to prove it.

## The two layers

| Layer | Question it answers                                                     | Where                   |
| ----- | ----------------------------------------------------------------------- | ----------------------- |
| RLS   | _Which companies' rows can this person touch at all?_ (tenant boundary) | PostgreSQL              |
| RBAC  | _What may this role do inside those companies?_                         | `authz.can`, in the API |

RLS does not know roles: a group-level auditor still passes the tenant policy for writes. The API's permission
check is what stops it. **Both layers are required in every feature.** Never rely on one.

## Rules for developers

1. Run every query on tenant tables inside `TenantDb.run(ctx, trx => ...)`. A query on the raw pool sees nothing, which is the safe failure.
2. Never take a company id from the request and trust it: check it with `authz.can(access, permission, {groupId, companyId})` after loading the company under RLS. Not found and not yours look the same (404).
3. New tenant table: add `company_id`, enable RLS, add select/insert/update (and delete if needed) policies using `app_company_allowed`, grant only what the runtime role needs, and add attack tests next to the existing ones.
4. Group-level access must be explicit and is always logged. There is no "super" path around RLS in application code. Operations without tenant context (login, back-channel logout) use narrow `SECURITY DEFINER` functions instead of broader policies.
5. Do not connect as `dcc_owner` from application code, and never add BYPASSRLS to a role.

## Known limits

- RLS protects rows, not what a legitimate member may do with data they can see (that is RBAC and audit).
- A database superuser can bypass everything: production database access must be tightly controlled and logged.

# Hirko: backend and DCC business logic

Your area: `apps/api/src/modules/`, your domain tables in `apps/api/migrations/` (reviewed by Dawit), `docs/api/`. Not yours: `apps/api/src/platform/` (login, sessions,
tenant context, audit, config): Dawit owns it; propose changes by issue.

## Read first (in this order)

1. [README](../../README.md), [OWNERSHIP](OWNERSHIP.md), [GIT-WORKFLOW](GIT-WORKFLOW.md).
2. The DCC proposal and team document (from Dawit): your modules are section 4B of the team document.
3. [ARCHITECTURE](../architecture/ARCHITECTURE.md), [TENANCY-AND-RLS](../security/TENANCY-AND-RLS.md), [AUDIT](../security/AUDIT.md), [DATABASE](../database/DATABASE.md).
4. [ADDING-A-MODULE](ADDING-A-MODULE.md) and the worked example in `apps/api/src/modules/companies/`.
5. Skim `apps/api/test/tenant-isolation.test.ts` and `api.e2e.test.ts`: this is the quality bar.

## Set up

```bash
git clone https://github.com/DawitBK/DCC.git && cd DCC && cp .env.example .env     # set DCC_LOCAL_ENCRYPTION_KEY
npm run setup && npm test                                                              # 92 tests should pass
npm run dev:api                                                                        # http://localhost:7716/api/docs
```

## What the foundation gives you

Sign-in and sessions, `req.access` (the caller's memberships), roles and permissions in `@dcc/contracts`, `authz.can`, `TenantDb.run` (RLS), the audit service, the Postgres
migration runner, the engine interface and `GovernedEngine` (you implement `ApprovalVerifier` and `FreezeCheck`, and a database `IdempotencyStore`).
Working examples: companies, brands, a read-only social-accounts list, an audit read API.

## The rules (non-negotiable)

1. Every query on company data goes through `TenantDb.run`. Check the permission per company with `authz.can`. Write an audit event in the same transaction.
2. Every new company-scoped table: `company_id`, RLS, policies, minimal grants, **attack tests**. See `tenant-isolation.test.ts`.
3. Never edit an applied migration. Timestamp-named SQL files.
4. Separation of duties: the approval workflow calls `assertDifferentPeople(creator, approver)`.
5. Never call Postiz directly: publishing goes through `GovernedEngine` (Woluman owns the adapter).
6. Validate input with zod schemas from `@dcc/contracts`; return the standard error shape.

## Your first tasks (details in [BACKLOG](../project/BACKLOG.md))

| ID   | Task                                                                                                                                            | Depends on                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| H-01 | 30-minute call with Dawit on module and table boundaries; write `docs/api/MODULE-PLAN.md`                                                       | none                         |
| H-02 | Social account registry: create/update, ownership, backup admin, assignment, status; audit events                                               | H-01, A-02 (data shape)      |
| H-03 | User and membership admin API: list people in scope, grant/revoke roles (respecting role scope), audit; the web app's role-based shell needs it | H-01                         |
| H-04 | Content and approval domain: versions, submit, review, approve/reject, history; approval policy by category; implement `ApprovalVerifier`       | A-05 (approval matrix), H-01 |
| H-05 | Publishing records, DB-backed idempotency store, publishing freeze (FR-15)                                                                      | H-04, W-03                   |
| H-06 | Incidents; analytics aggregation; notifications                                                                                                 | H-04                         |
| H-07 | OpenAPI documentation and API contract notes with Rahel                                                                                         | continuous                   |

Business rules (who approves what) come from Abenezer's register and Dawit's decisions: do not invent them. Ask in an issue.

# DCC architecture

Owner: Dawit. Diagrams: [DIAGRAMS.md](DIAGRAMS.md). Decisions and their reasons: [ADRs](decisions/README.md).

## 1. The shape

Three parts, kept apart on purpose:

1. **DCC Governance Portal** (this repository): a Next.js web app and a NestJS API on PostgreSQL. It owns
   companies, people, roles, social-account records, approvals, audit, security, incidents and reporting.
2. **Postiz** (separate, customised, self-hosted): schedules and publishes to the networks. It has its own
   database, its own Redis and its own scheduler. DCC reaches it only through its public API.
3. **The existing Kerchanshe SSO / IdP**: proves who a person is (OpenID Connect). DCC creates no passwords.

The portal is the authority. Postiz executes only what the portal has authorised, and the portal can swap
the engine for another without redesign because it talks to an interface, not to Postiz ([ADR-0006](decisions/ADR-0006-postiz-separate-service.md)).

## 2. DCC is a modular monolith

One API process, one database, clear internal boundaries. No microservices ([ADR-0001](decisions/ADR-0001-modular-monolith.md)).

```
apps/api/src
  platform/          cross-cutting foundation (Dawit)
    auth/            OIDC login, sessions, access resolution
    authz/           permission checks, separation of duties
    tenancy/         TenantDb: the only door to tenant data
    audit/           append-only, hash-chained audit trail
    crypto/          secrets/encryption provider interface
    database/        pool, migrations, schema types
    observability/   request ids, JSON logs, health, metrics
    http/            validation, CSRF origin check, error shape
  modules/           business modules (Hirko): companies, social-accounts, audit read API today;
                     content, approvals, incidents, analytics next
packages/
  contracts/         roles, permissions, API types shared by API and web
  operational-engine/ engine interface, governance gate, Postiz adapter
```

Rules between layers:

- A controller declares a coarse permission, validates input with a zod schema from `contracts`, and calls a service.
- A service runs **every** query on company data inside `TenantDb.run(...)` (so the database enforces isolation), re-checks the permission for the specific company with `authz.can`, and writes an audit event in the same transaction.
- Nothing outside `platform/` talks to the identity provider, signs sessions, or sets tenant context.
- Nothing outside `packages/operational-engine` talks to Postiz. Publishing from DCC goes through `GovernedEngine`.

## 3. Who decides what

| Question                                   | Decided by                             | Where                      |
| ------------------------------------------ | -------------------------------------- | -------------------------- |
| Who is this person?                        | Kerchanshe SSO                         | OIDC login                 |
| Are they a DCC administrator at the start? | SSO application role `dcc-group-admin` | claim, then DCC membership |
| Which company and role do they have?       | DCC                                    | `memberships` table        |
| May they do X in company Y?                | DCC                                    | `authz.can` + database RLS |
| May this post be published?                | DCC approval workflow                  | `GovernedEngine` gate      |
| How is it published to the network?        | Postiz                                 | its API                    |
| Is the social account connected?           | Official network OAuth, done in Postiz | Postiz                     |

## 4. Technology and why

| Layer          | Choice                                                      | Reason                                                                                                          |
| -------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Web            | Next.js 16, React 19, Tailwind 4, TypeScript                | proposal baseline; same as the Group's other systems                                                            |
| API            | NestJS 12, Node 22, REST + OpenAPI (Swagger at `/api/docs`) | proposal baseline; modular structure suits five people                                                          |
| Database       | PostgreSQL 17 with row-level security                       | company isolation enforced below the application                                                                |
| Data access    | Kysely (typed SQL builder) + plain SQL migrations           | RLS and audit are SQL features; no ORM magic to fight ([ADR-0005](decisions/ADR-0005-kysely-sql-migrations.md)) |
| Sessions       | in PostgreSQL                                               | no Redis needed yet ([ADR-0004](decisions/ADR-0004-no-broker-no-redis-yet.md))                                  |
| Queue / broker | none yet; BullMQ on Redis when a worker is justified        | proposal lists RabbitMQ; a requirement does not exist yet                                                       |
| Identity       | existing SSO, OIDC code flow + PKCE, `openid-client`        | mandatory decision                                                                                              |
| Secrets        | `SecretsProvider` interface; dev implementation only        | production key service is an open decision (D-05)                                                               |
| Validation     | zod, shared between API and web                             | one definition of each input                                                                                    |
| Tests          | Vitest; real PostgreSQL; real Nest app                      | the risks are in the database and the HTTP layer, so that is where we test                                      |
| CI             | GitHub Actions + CodeQL + Dependabot                        | proposal baseline                                                                                               |

## 5. Not built, deliberately

- **Redis, RabbitMQ, a worker app:** no requirement needs them yet. They arrive with the first feature that does (scheduled reports, reconciliation), with an ADR.
- **Docker images for DCC itself:** the Group's production server runs Node processes without Docker; DCC deploys the same way ([ADR-0010](decisions/ADR-0010-deployment-model.md)). Docker is used for local PostgreSQL and for Postiz.
- **Kubernetes, service mesh, Terraform:** nothing here needs them.
- **Prometheus/Grafana/SIEM deployment:** the API exposes health and metrics and structured logs; deploying the collectors is an infrastructure task ([OBSERVABILITY](../devops/OBSERVABILITY.md)).

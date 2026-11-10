# Architecture Decision Records

One short file per significant decision: what was decided, why, what else was considered. Status values:
**Accepted** (the architect decided), **Proposed** (recommendation awaiting the architect), **Superseded**.
To change a decision, write a new ADR that supersedes the old one; do not rewrite history.

| #                                           | Decision                                                              | Status   |
| ------------------------------------------- | --------------------------------------------------------------------- | -------- |
| [0001](ADR-0001-modular-monolith.md)        | Modular monolith, not microservices                                   | Accepted |
| [0002](ADR-0002-postgres-rls-tenancy.md)    | Company isolation by PostgreSQL row-level security                    | Accepted |
| [0003](ADR-0003-oidc-server-sessions.md)    | Existing SSO via OIDC, server-side sessions in PostgreSQL             | Accepted |
| [0004](ADR-0004-no-broker-no-redis-yet.md)  | No Redis, RabbitMQ or worker until a requirement needs them           | Accepted |
| [0005](ADR-0005-kysely-sql-migrations.md)   | Kysely and plain SQL migrations                                       | Accepted |
| [0006](ADR-0006-postiz-separate-service.md) | Postiz as a separate, pinned service behind an interface              | Accepted |
| [0007](ADR-0007-secrets-provider.md)        | Secrets provider interface; production key service pending            | Proposed |
| [0008](ADR-0008-monorepo-boundaries.md)     | npm workspaces monorepo and package boundaries                        | Accepted |
| [0009](ADR-0009-git-workflow.md)            | Lightweight GitFlow, PR-based                                         | Accepted |
| [0010](ADR-0010-deployment-model.md)        | DCC deploys as Node processes; Docker for Postiz and local PostgreSQL | Proposed |
| [0011](ADR-0011-audit-hash-chain.md)        | Append-only audit trail with a hash chain                             | Accepted |

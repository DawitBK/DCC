# ADR-0006: Postiz as a separate, pinned service behind an interface

**Status:** Accepted · **Deciders:** Dawit (Postiz chosen as the engine)

**Context.** Postiz (AGPL-3.0, pnpm monorepo: Next.js, NestJS, Prisma, PostgreSQL, Redis, Temporal) is the selected engine. Its official self-host stack is nine containers including Temporal, Elasticsearch and a second PostgreSQL. It has a public API (`/public/v1`, API-key auth) with posts, channels, analytics and media endpoints, and webhooks.
**Decision.**

1. Postiz runs as its **own deployment** with its own databases, on a separate Linux/Docker host. DCC never reads or writes its database.
2. The repository keeps only: the engine **interface**, the **governance gate**, the **adapter**, and deployment notes. Postiz source is not copied into DCC.
3. A **tested release is pinned** (`infra/postiz/VERSION`, currently v2.25.3); upgrades are deliberate.
4. A **separate DCC-owned Postiz fork** is created only if source changes are really needed, and only with Dawit's approval (and a legal look at AGPL).
5. DCC stays the authority: approvals, freeze and idempotency are enforced in DCC before the engine is called ([POSTIZ-INTEGRATION](../../engine/POSTIZ-INTEGRATION.md)).
   **Alternatives.** Embedding Postiz source (rejected: licence and upgrade burden). Re-implementing publishing (rejected: the point of the hybrid approach).
   **Consequences.** Hosting Postiz is a separate infrastructure task (open decision D-03). Gaps found so far: no inbox or comments API in Postiz's public API v1.0.0, so the proposal's unified inbox is not covered by it ([PROPOSAL-REVIEW](../../requirements/PROPOSAL-REVIEW.md)).

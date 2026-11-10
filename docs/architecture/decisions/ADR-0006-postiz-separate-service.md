# ADR-0006: Postiz as a separate, pinned service behind an interface

**Status:** Accepted · **Deciders:** Dawit (Postiz chosen as the engine)

**Context.** Postiz (AGPL-3.0, pnpm monorepo: Next.js, NestJS, Prisma, PostgreSQL, Redis, Temporal) is the selected engine. Its official self-host stack is nine containers including Temporal, Elasticsearch and a second PostgreSQL. It has a public API (`/public/v1`, API-key auth) with posts, channels, analytics and media endpoints, and webhooks.
**Decision.**

1. Postiz runs as its **own deployment** with its own databases, on a separate Linux/Docker host. DCC never reads or writes its database.
2. The repository keeps only: the engine **interface**, the **governance gate**, the **adapter**, and deployment notes. Postiz source is not copied into DCC.
3. A **tested release is pinned** (`infra/postiz/VERSION`, currently v2.25.3); upgrades are deliberate.
4. **Postiz is customised in a fork** (decision D-12/D-18, 2026-11-11): `DawitBK/postiz-app`, forked from `gitroomhq/postiz-app`. Work branches start from the pinned tag. Customisation is Woluman's work package: the unified inbox endpoints, per-company channel boundaries and anything else the public API lacks. The fork is a separate repository and is deployed separately; its source never enters this repo. Licence is not a constraint (D-09).
5. DCC stays the authority: approvals, freeze and idempotency are enforced in DCC before the engine is called ([POSTIZ-INTEGRATION](../../engine/POSTIZ-INTEGRATION.md)).
   **Alternatives.** Embedding Postiz source (rejected: licence and upgrade burden). Re-implementing publishing (rejected: the point of the hybrid approach).
   **Consequences.** Hosting Postiz is a separate infrastructure task (open decision D-03). Gap found: no inbox or comments API in Postiz's public API v1.0.0, so the unified inbox is added in the fork (D-12) and DCC reads it through the engine interface ([PROPOSAL-REVIEW](../../requirements/PROPOSAL-REVIEW.md)). Cost: the fork must be rebased on each upstream release we adopt, so keep changes small, in their own modules and behind tests.

# ADR-0008: npm workspaces monorepo and package boundaries

**Status:** Accepted · **Deciders:** Dawit

**Context.** Web, API and the engine adapter must agree on types, and five people work in parallel.
**Decision.** One repository, npm workspaces (`apps/*`, `packages/*`). Only two packages exist because only two things are genuinely shared: `@dcc/contracts` (roles, permissions, API schemas and types) and `@dcc/operational-engine` (interface, gate, adapters). Identity, tenancy, audit and database code live in `apps/api/src/platform`: they are used by one app, so extracting packages would add ceremony without benefit. Extract a package when a second consumer appears.
**Alternatives.** pnpm/turbo/nx (rejected: more tooling than five people need; npm is what the Group's systems use). A package per concern (rejected: premature).
**Consequences.** `npm run build:packages` must run before the apps build (the root `build` script does it).

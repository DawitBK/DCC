# ADR-0008: npm workspaces monorepo and package boundaries

**Status:** Accepted · **Deciders:** Dawit

**Context.** Frontend, backend and the engine client must agree on types, and five people work in parallel.
**Decision.** One repository, npm workspaces (`portal/*`: `backend`, `frontend`, `contracts`, `engine-client`). Only two packages exist because only two things are genuinely shared: `@dcc/contracts` (roles, permissions, API schemas and types) and `@dcc/engine-client` (interface, gate, adapters). Identity, tenancy, audit and database code live in `portal/backend/src/platform`: they are used by one app, so extracting packages would add ceremony without benefit. Extract a package when a second consumer appears.
**Alternatives.** pnpm/turbo/nx (rejected: more tooling than five people need; npm is what the Group's systems use). A package per concern (rejected: premature).
**Consequences.** `npm run build:packages` must run before the backend and frontend build (the root `build` script does it).

# Who works where

**Ownership means who is responsible and who must review. It does not mean who is physically able to edit.**
GitHub gives every collaborator write access to the whole repository: nothing stops you typing in someone else's folder. What stops a bad change
is the process: [CODEOWNERS](../../.github/CODEOWNERS) (the owner is asked to review), pull requests (nothing reaches `develop` directly), and CI. Respect
the map below, and when you need a change in someone else's area, ask them first and say so in the pull request.

## The map

| Area                                                                                                | Primary owner     | You may                                                        | Needs their review                                        |
| --------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| `portal/frontend/`, `docs/design/`                                                                  | **Rahel**         | everything in your area                                        | Dawit for CSP, auth, anything calling the API differently |
| `portal/backend/src/modules/`                                                                       | **Hirko**         | everything in your modules; add new module folders             | Dawit for anything touching `platform/` or tenancy        |
| `portal/backend/migrations/`                                                                        | Dawit + **Hirko** | add migrations for your domain tables                          | both; never edit an applied migration                     |
| `portal/engine-client/`, `operational-engine/`, `docs/engine/`, `docs/integrations/`                | **Woluman**       | everything, except the gate and interface files                | Dawit for `governed.ts` and `engine.ts`                   |
| `docs/requirements/`, `docs/discovery/`, `docs/onboarding/`                                         | **Abenezer**      | everything (templates, summaries; **no real data**, see below) | Dawit                                                     |
| `portal/backend/src/platform/`, `portal/backend/src/config/`, `portal/backend/test/`                | **Dawit**         | read, propose changes by pull request                          | Dawit                                                     |
| `portal/contracts/`                                                                                 | shared            | add types and schemas for your feature                         | Dawit + the consuming owner                               |
| `infra/`, `scripts/`, `.github/`, `docs/architecture,security,identity-and-sso,devops,team,project` | **Dawit**         | read; propose changes by pull request                          | Dawit                                                     |

## Do and do not

**Do:** work only on your own branches; talk to the owner before changing their area; put API changes in `portal/contracts` and tell the other side;
add tests next to the code you change; write a migration for every schema change.

**Do not:**

- touch `portal/backend/src/platform/` (login, sessions, tenant context, audit, config). If you think it needs to change, open an issue.
- query tenant tables outside `TenantDb.run`, create a database connection of your own, or connect as the owner role.
- call Postiz from anywhere except `portal/engine-client`, or publish without `GovernedEngine`.
- edit a migration that is already merged.
- put secrets, real people's data, real account inventories or the proposal documents in Git (the repository is public).
- push to `main` or `develop`, or rewrite shared history.

## Shared areas: how to change them

`portal/contracts`, API contracts, shared configuration, database-wide changes, authentication/authorization, tenant context, infrastructure and the build
are shared. A change needs the owner of the side that produces it and the owner of the side that consumes it, plus Dawit. Raise it as an issue first.

## Real organisational data does NOT go in this repository

Abenezer collects real subsidiaries, brands, accounts and people. The repository is public, so the **templates, structure and findings** live here and
the **real data** lives in a private store decided by Dawit (decision D-02). The folders `docs/discovery/private/`, `docs/requirements/private/` and
`docs/onboarding/private/` are git-ignored as a safety net for local work files: they are not a place to share data.

# DCC handover: the current state, how to run it, what is next

**Read this first if you are picking DCC up (a developer, or an assistant working for one).** It is the one page that says where the
project is. It replaces the earlier status notes. Last updated: 2026-11-24 (sections 2 and 3 and the progress note under section 5; the rest is as of 2026-11-15).

The owner's decisions made in conversation on 2026-11-14 and 2026-11-15 are written in section 6. **Where they differ from an older
document, they win.**

## 1. The three parts and where they live

| Part               | Folder                 | What it is                                                                                                                        |
| ------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Portal backend     | `portal/backend`       | NestJS API on PostgreSQL. `src/platform` = sign-in, sessions, tenancy, audit, config. `src/modules` = the business features.      |
| Portal frontend    | `portal/frontend`      | Next.js web app. `src/app/screens` = one file per screen, `src/components` = shared parts, `src/lib` = API calls, labels, access. |
| Shared contracts   | `portal/contracts`     | Roles, permissions, request schemas (zod) and response types used by both sides.                                                  |
| Engine client      | `portal/engine-client` | How the portal talks to the engine: the interface, the approval gate, the Postiz adapter, the practice engine.                    |
| Operational engine | `operational-engine`   | Postiz v2.25.3: compose file, settings template, notes. Its source code is not in this repository.                                |
| Documents          | `docs`                 | `docs/team` = handbook per person, `docs/api` = endpoints, `docs/engine` = Postiz, `docs/project` = status and backlog.           |

## 2. What is built

**Backend** (every feature has tests, including "another company cannot see or change this" tests):

- Sign-in through the Kerchanshe SSO, sessions, "sign in again" for sensitive actions, company isolation, 11 roles, audit trail with checkpoints.
- A person may hold several roles and **choose one to act as** for the session (`PUT /api/me/acting-role`).
- Companies and brands (create, rename, suspend, archive), social account registry, people and roles (grant by email).
- Content with versions, **pictures and videos** (`POST /api/media`, files on disk, checked by what the file really is), categories.
- Approval rules as data: per company and category, how many people and which roles; the rule is fixed when a post is submitted.
- Publishing through the approval gate: now or **scheduled**; **cancel** a scheduled post; **reconcile** (ask the engine what happened);
  freeze per company or account; a suspended company publishes nothing.
- Unified inbox through the engine (read, reply; replies audited and stopped by a freeze).
- Incidents, notifications, reports, dashboard, security overview, audit search and export.

**Frontend:** every screen calls the real API: dashboard, composer (categories, versions, media, a preview per network), approvals,
publishing, calendar, inbox, accounts (engine channel linking), companies and brands, people and roles, approval rules, audit,
security overview, incidents, notifications, role chooser and switcher. Analytics is real (figures as the engine returns them, per account, never summed; empty is not zero), and the inbox has assignment and response-time targets.

**Engine:** Postiz v2.25.3 runs locally from `operational-engine/compose.postiz.yml`. The adapter was run against it: listing channels
and posts and the refusal cases work. DCC can show the **real engine's channels and practice channels side by side**
(`DCC_ENGINE_PRACTICE_CHANNELS=true`): practice channels have ids starting with `fake-`, and nothing sent to them leaves the computer.

## 3. What is NOT done or NOT proven (do not claim otherwise)

| Item                                                | State                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A real post on a real network                       | **Not proven.** Needs a developer app per network: `docs/engine/CONNECT-REAL-ACCOUNTS.md`.                                                                                                                                                                 |
| Sending pictures and videos to Postiz               | The adapter's own upload was run against the live Postiz on 2026-11-24 (a picture uploaded without publishing). A **post that carries the file** has not been run: it needs a connected channel.                                                           |
| The inbox against real networks                     | Stock Postiz has no inbox. DCC's inbox shows practice messages only until the fork has one.                                                                                                                                                                |
| Browser check of every role and every write flow    | Pass 1 done 2026-11-24: 11 roles x 14 screens at desktop and phone width, and most write flows ([record](../testing/results/2026-11-24-BROWSER-PASS.md)). Still owed: the write flows listed there, every write flow at phone width, the mirror signed in. |
| Automatic reconciliation                            | On request only (a button). No background job, on purpose (no workers in DCC).                                                                                                                                                                             |
| Analytics, Amharic, e-mail notifications            | Analytics built (the real provider numbers only with a real account). Amharic and e-mail notifications: not built.                                                                                                                                         |
| Postiz look and behaviour changes (branding, inbox) | Not started: they belong in the fork `DawitBK/postiz-app`.                                                                                                                                                                                                 |
| Any server installation                             | Nothing is deployed anywhere. Everything runs on a developer computer.                                                                                                                                                                                     |
| Networks other than the six (Bluesky, Telegram ...) | Their channels appear in the engine list but cannot be tied to a registered account.                                                                                                                                                                       |

## 4. How to run it

**Development** (ports come from `.env`; on this PC 7916 API and 7917 web):

```
npm run setup                 # first time: install, database in Docker, migrations, small seed
npm run dev:backend           # API
npm run dev:frontend          # web
npm run dev:session -- you@example.test group_admin        # a signed-in session without the SSO (development only)
```

**Sample data** (three companies, people in every role, linked accounts, content in every state, freeze, incidents). The backend must be
running with practice channels:

```
I_UNDERSTAND_THIS_SEEDS_SAMPLE_DATA=dcc_dev node scripts/run-with-env.mjs .env node scripts/demo/seed-sample-data.mjs
```

**The engine:** `operational-engine/CUSTOMIZATIONS.md` (start Postiz, make the administrator, copy the API key into `.env`:
`ENGINE_PROVIDER=postiz`, `POSTIZ_BASE_URL`, `POSTIZ_API_KEY`, `DCC_ENGINE_ALLOW_UNVERIFIED=true`, `DCC_ENGINE_PRACTICE_CHANNELS=true`).
Check the adapter: `npm run verify:live -w @dcc/engine-client`.

**Mirror** (the rehearsal copy next to the SSO, DMS and GMS mirrors; started by `start-mirror-all.ps1` one folder up): web at
`http://localhost:8090/dcc`, API 9716, web 9717, settings in `.env.mirror`. After a code change: `npm run mirror:db` (migrations), then
`npm run build:mirror`, then restart the two DCC processes.

**Before every pull request:** `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check && npm run secrets:scan`.

If a port gives `EACCES` on Windows: `docs/devops/WINDOWS-PORTS.md` (and `deploy/reserve-dev-ports.ps1` one folder up, run once as administrator).

## 5. What to do next, in order

| #   | Step                                                                                                                                                        | Area              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | Create one developer app (LinkedIn is the quickest), connect a real test account in Postiz, link it in DCC                                                  | engine            |
| 2   | Prove one real text post, then one with a picture, then a scheduled post and its cancel; record the result; fix the adapter where the real engine disagrees | engine client     |
| 3   | Full browser pass: every role, every write flow, phone width; fix what it finds                                                                             | frontend, backend |
| 4   | Postiz fork: Kerchanshe look, registration closed, the inbox (comments and messages) exposed on its API                                                     | engine            |
| 5   | DCC inbox against the fork's inbox; assignment and response-time targets                                                                                    | backend, frontend |
| 6   | Analytics from the engine's numbers; monthly report                                                                                                         | backend, frontend |
| 7   | Remaining edit screens found by step 3; Amharic                                                                                                             | frontend          |
| 8   | Real companies, accounts and approval rules entered on the screens (from the collected data)                                                                | requirements      |
| 9   | Test server, then pilot with one company                                                                                                                    | lead              |

**Progress against this list on 2026-11-24** (detail and status of every row: [BACKLOG](BACKLOG.md)): steps 5 and 6 are built (inbox assignment
and response targets; analytics and the monthly report), against the fake engine and the practice channels. Step 3 had its first full pass
(see section 3). Added since 2026-11-15: stuck-publish-key settling and the suspected-bypass check, incident categories and recovery
contacts (structure only, no content until section 4B of the team document is supplied), audit events with no company now belong to a
group, a content security policy with a nonce, the idle timeout that an open tab no longer defeats, and automated integration tests for
the publishing path, screens-API-database agreement and company separation. Steps 1, 2 and 4 wait on a developer app and a connected
real account; step 8 waits on the owner and Abenezer; step 9 waits on the test server (D-04).

## 6. Owner decisions of 2026-11-14 and 2026-11-15 (they override older documents)

1. **Build first, verify later.** Only necessary tests while building; a dedicated verification pass follows.
2. **Two-factor sign-in is optional for now**, for ease of testing: `DCC_REQUIRE_MFA=false` in development and on the mirror.
   Production still refuses to start with it off. This changes the earlier "MFA is always enforced" line for non-production only.
3. **A person can hold several roles and choose which to act as** when signing in, as in the DMS.
4. **Posts carry pictures and videos, and the portal shows a preview** of the post as each network would show it.
5. **Inbox roles:** company administrator and Group marketing read; company executive, marketing manager and publisher read and reply.
6. **Pull requests name the part of the system and the person whose area it is**; the lead may merge his own pull requests when CI is green.
7. **The mirror is a place to try things**: it carries sample data and practice channels. It is not the live server.
8. Work stays local until a block of work is complete, then it is pushed as pull requests into `develop`.

## 7. Rules that still hold (short form; the full text is `CLAUDE.md`)

- Nothing is published except through the approval gate (`GovernedEngine`). Postiz is called only from `portal/engine-client`.
- Company data is read and written only inside `TenantDb.run`; every change writes an audit event in the same transaction.
- No real secrets, keys or personal data in the repository (it is public). Settings live in `.env` files, which are never committed.
- Never edit a merged migration: add a new one. Never weaken or delete a test to make something pass.
- Folder structure: do not add top-level folders.
- Commit and pull request text never names an assistant or tool.

# DCC handover: the current state, how to run it, what is next

> **2026-11-25: read [NEXT-AGENT-HANDOFF-2026-11-25](NEXT-AGENT-HANDOFF-2026-11-25.md) first.** It says what the two latest sessions did, what is proven, what is not done and the exact next steps in order. Sections 2, 3 and 5 below are older than it where they differ.

**Read this first if you are picking DCC up (a developer, or an assistant working for one).** It is the one page that says where the
project is. It replaces the earlier status notes. Last updated: 2026-11-25 (sections 2 to 5; the rest is as of 2026-11-15).

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

**Engine:** a **practice network** (a pretend network, [PRACTICE-NETWORK](../engine/PRACTICE-NETWORK.md)) lets a post go from "approved" to "arrived" through the real approval gate, the adapter and a real Postiz built from the fork, with schedule and cancel (`node scripts/verify/practice-network-e2e.mjs`). Postiz v2.25.3 runs locally from `operational-engine/compose.postiz.yml`. The adapter was run against it: listing channels
and posts and the refusal cases work. DCC can show the **real engine's channels and practice channels side by side**
(`DCC_ENGINE_PRACTICE_CHANNELS=true`): practice channels have ids starting with `fake-`, and nothing sent to them leaves the computer.

## 3. What is NOT done or NOT proven (do not claim otherwise)

| Item                                                | State                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A real post on a real network                       | **Not proven.** Needs a developer app per network: `docs/engine/CONNECT-REAL-ACCOUNTS.md`. A post **has** gone through DCC and a real Postiz to a practice network (2026-11-25, [record](../testing/results/2026-11-25-POSTIZ-ENGINE-RUN.md)).             |
| Sending pictures and videos to Postiz               | The adapter's own upload ran against the live Postiz (2026-11-24 and 2026-11-25, with a channel). A **post that carries the file** through the governed path has not been run.                                                                             |
| The inbox against real networks                     | The fork's inbox works end to end against the practice network (2026-11-25; `DCC_ENGINE_POSTIZ_INBOX=true`, [FORK-INBOX-API](../engine/FORK-INBOX-API.md)). The readers of the real networks have never run against a real network.                        |
| Browser check of every role and every write flow    | Pass 1 (2026-11-24) and the full pass of the final screens (2026-11-25): 11 roles x 21 screens x phone and desktop x light and dark ([record](../testing/results/2026-11-24-BROWSER-PASS.md)). Not covered: Firefox, Safari, screen readers, real devices. |
| Automatic reconciliation                            | On request only (a button). No background job, on purpose (no workers in DCC).                                                                                                                                                                             |
| Analytics, Amharic, e-mail notifications            | Analytics built (the real provider numbers only with a real account). Amharic and e-mail notifications: not built.                                                                                                                                         |
| Postiz look and behaviour changes (branding, inbox) | An image **built from our fork** runs (`dcc-postiz:practice-2`, with the practice channel type). Kerchanshe look, registration closed and the inbox are not done.                                                                                          |
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

| #   | Step                                                                                                                                                                                                                                           | Area                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | One developer app (LinkedIn is the quickest), a real test account connected in Postiz, linked in DCC; then one real text post, one with a picture, a scheduled post and its cancel; record it; fix the adapter where the real engine disagrees | engine, engine client |
| 2   | Connect a practice channel **through the engine's own screen** (the 2026-11-25 channel was a seeded fixture) and run the two proof scripts again                                                                                               | engine                |
| 3   | The real networks' inbox readers run against a real network (the fork's inbox and DCC's adapter are built and proven on the practice network)                                                                                                  | engine, backend       |
| 4   | Kerchanshe look and registration closed in the fork; engine administrator sign-in through the Group SSO in a test instance (W-07)                                                                                                              | engine                |
| 5   | Approval routing by category and level (H-09) on the working policy (D-26, D-29)                                                                                                                                                               | backend               |
| 6   | The usability test with real people (L-19); then UAT with the scripts in `docs/testing/UAT-SCRIPTS.md`                                                                                                                                         | lead, requirements    |
| 7   | Real companies, accounts and approval rules entered on the screens (from the collected data); the signed approval matrix                                                                                                                       | requirements          |
| 8   | Amharic                                                                                                                                                                                                                                        | frontend              |
| 9   | The live server and the pilot with one company (manual deployment, approved by Dawit; the mirror is the test environment, D-28)                                                                                                                | lead                  |

**Done since the list of 2026-11-15** (detail and status of every row: [BACKLOG](BACKLOG.md)): the full browser pass, inbox assignment and response targets, analytics, stuck-key settling, the suspected-bypass check, incident categories and recovery contacts (structure; content waits for section 4B of the team document), audit events with no company belong to a group, a content security policy with a nonce, the idle timeout an open tab no longer defeats, 21 screens on a shared kit, the practice network and the first post through a real Postiz, and the status documents of this date.

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

# DCC: where things stand and the path to the finish line (2026-11-14)

Written by Dawit for the whole team. It says what exists today, what was really run, what is not proven, and the ordered steps left.
Nothing here is deployed to a server.

## 1. In one paragraph

The three parts now move together. The **backend** has every module of the proposal except reconciliation and analytics. The **frontend** has every
screen connected to that backend. The **operational engine** (Postiz v2.25.3) runs on a developer computer from our own compose file and DCC's adapter
talks to it. What is still missing is outside the code: the social networks' developer apps (so a real account can be connected and a real post
proven), a test server, and the full verification pass in the browser for every role.

## 2. Pull requests of this round

| PR  | Part of the system                   | Area of (task allocation)      | State                                  |
| --- | ------------------------------------ | ------------------------------ | -------------------------------------- |
| 26  | Platform, review fixes, plans        | Dawit                          | merged                                 |
| 28  | Backend modules                      | Hirko (H-08, H-09, H-10)       | merged                                 |
| 29  | Operational engine and engine client | Woluman (W-01, W-03, W-09)     | merged                                 |
| 30  | Frontend, every screen               | Rahel (R-03, R-04, R-06, R-07) | open at time of writing                |
| 25  | Frontend review branch (Rahel's own) | Rahel                          | reviewed; its commits are inside PR 30 |

Each of 28, 29 and 30 was prepared by Dawit inside the owner's area so that the three parts keep the same pace. **Task allocation and workflow do not
change**: each owner continues in their own folder, on their own branches, from `develop`.

## 3. Backend (portal/backend, portal/contracts)

Built and tested (236 backend tests, with other-company attack tests for every new table and endpoint):

| Capability                                  | Endpoints                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Engine status and channels, link an account | `GET /api/engine/status`, `GET /api/engine/channels`, `PATCH /api/social-accounts/:id/engine-channel` |
| Approval rules as data                      | `/api/content-categories` (GET, POST, PATCH), `/api/approval-policies` (GET, PUT, DELETE)             |
| Company and brand editing                   | `PATCH /api/companies/:id`, `PATCH /api/companies/:id/brands/:brandId`                                |
| Security overview                           | `GET /api/security/posture`                                                                           |
| Unified inbox through the engine            | `GET /api/inbox`, `POST /api/inbox/reply`                                                             |
| Scheduling and calendar                     | `scheduledAt` on `POST /api/content-items/:id/publish`, `GET /api/publications?from=&to=`             |
| Guards                                      | an inactive company publishes nothing; the last group administrator cannot be removed                 |

Not built: reconciliation with the engine (a scheduled post stays `scheduled` until that exists), cancelling a scheduled post, analytics, media.

## 4. Frontend (portal/frontend)

Every screen calls the real API with the types from `@dcc/contracts`: dashboard, composer, approvals, publishing, calendar, inbox, accounts,
companies and brands, people and roles, approval rules and categories, audit, security overview, incidents, notifications.
All 40 API paths the frontend calls were checked against the backend's routes: every one exists.
Analytics shows "not available yet". Sample screens exist only behind the development role preview.

Checked: lint, typecheck, build; a real browser as group administrator (real data, no page errors, no sideways scroll at 320 px).
**Not checked:** write flows end to end in the browser, the other ten roles, and the newest screens against a running backend.

## 5. Operational engine (operational-engine, portal/engine-client)

Postiz v2.25.3 runs locally from `operational-engine/compose.postiz.yml` (differences from upstream and the run steps: `CUSTOMIZATIONS.md`).
The live check (`npm run verify:live -w @dcc/engine-client`) passed 5 of 5 against it: list channels, list posts, wrong key refused, unknown channel
refused before anything is sent, unreachable engine reported as "outcome unknown".
DCC connects to a real Postiz with `ENGINE_PROVIDER=postiz` and `DCC_ENGINE_ALLOW_UNVERIFIED=true`; the default stays the practice engine.

**Not proven:** a real network connected, a real post, scheduling and deleting a post on a real channel, media, the inbox (it comes from our fork,
W-08; with stock Postiz DCC's inbox endpoints answer "the engine has no inbox yet").

## 6. Configurable from the screens (no code change needed)

Companies and brands (create, rename, suspend, archive), social accounts and their engine channel, people and roles, content categories,
approval rules per company and category (how many people, which roles), publishing freeze per company or account, incidents.
Still fixed in code on purpose: the 11 roles and what each may do (`portal/contracts/src/permissions.ts`): changing them changes security.

## 7. Assumptions made in this round (Dawit to confirm or change)

- **ASM-09 Inbox permissions.** Read: company administrator, group marketing. Read and reply: company executive, company marketing manager, publisher.
- A reply is refused while the company or account is frozen, and for a suspended or archived company.
- With no approval rule set, one approver settles a request (as before). A rule is fixed on a request when it is submitted.

## 8. Path to the finish line, in order

| #   | Step                                                                                                       | Who             | Blocked by                |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------- | ------------------------- |
| 1   | Merge PR 30; release PR `develop` to `main`                                                                | Dawit           | CI                        |
| 2   | Dedicated verification session: every role, every write flow, in a real browser, on the new build          | Dawit, Rahel    | nothing                   |
| 3   | Apply for the developer apps of the six networks (D-11); connect one real test account in Postiz           | Dawit, Woluman  | the networks' approval    |
| 4   | Prove one real post, a scheduled post and a delete (`POSTIZ_VERIFY_CHANNEL_ID`); mark the adapter verified | Woluman         | step 3                    |
| 5   | Reconciliation: read post states back from the engine, move `scheduled` to `published` or `failed`, cancel | Hirko, Woluman  | step 4 for the real proof |
| 6   | Unified inbox in the Postiz fork (W-08), then DCC's inbox against it                                       | Woluman         | step 3                    |
| 7   | Test server (D-04): DCC behind Apache at `/dcc`, Postiz on WSL2, SSO client registered                     | Dawit           | a server                  |
| 8   | Approval matrix and real accounts from the companies (Abenezer's collection), entered on the screens       | Abenezer, Dawit | data collection           |
| 9   | Analytics, media uploads, Amharic                                                                          | Hirko, Rahel    | steps 4 and 5             |
| 10  | Pilot with one company, then rollout (`docs/rollout/`)                                                     | all             | steps 2 to 8              |

Only the owner can do: the test server, the developer-app applications, the mirror SSO licence renewal, the legal review (D-15),
the repository setting "delete merged branches".

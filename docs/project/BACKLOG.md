# Backlog

Owner: Dawit. Last updated 2026-11-14. Source of truth for status is GitHub Issues (create one per row, copy the ID into the
title: `[H-03] ...`). **No issues have been created yet: until they are, this file is the record.**
Priority: **P0** blocks others or is security-critical, **P1** needed for the pilot, **P2** later.

Status: ✅ done and verified · 🟡 built or written, one part still open (the note says which) · 📄 written, cannot be carried out
yet · ⬜ not started · ⛔ dropped.

Every task follows the [Definition of Done](DEFINITION-OF-READY-AND-DONE.md). Dependencies are drawn in [DEPENDENCIES](DEPENDENCIES.md).
No task assumes a business decision that has not been recorded in [OPEN-DECISIONS](OPEN-DECISIONS.md).

## Epic 1: Architecture and technical design (Dawit)

| ID   | Task                                                   | Pri | Status | Acceptance / note                                                                                                          |
| ---- | ------------------------------------------------------ | --- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| L-01 | Architecture, diagrams, ADRs                           | P0  | ✅     | docs/architecture complete and consistent with the code                                                                    |
| L-02 | Review and approve the module boundary plan from Hirko | P0  | ✅     | approved 2026-11-14; five findings fixed, seven questions answered: [review](reviews/2026-11-13-BACKEND-MODULES-REVIEW.md) |
| L-03 | Resolve open decisions D-01..D-20                      | P0  | ✅     | all twenty answered 2026-11-11; only D-15 waits for legal input from outside the team                                      |

## Epic 2: Identity and SSO (Dawit)

| ID   | Task                                                                         | Pri | Status | Acceptance / note                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------- | --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-04 | OIDC sign-in, sessions, back-channel logout against the existing SSO         | P0  | ✅     | verified in a real browser against dev SSO                                                                                                                           |
| L-05 | Confirm MFA enforcement and passkeys for privileged roles with the SSO owner | P0  | ✅     | written answer: [MFA-AND-PASSKEYS](../identity-and-sso/MFA-AND-PASSKEYS.md). Two factors enforced twice, proven in a real browser 2026-11-14; passkeys not available |
| L-06 | Register the production client (HTTPS, real secret)                          | P1  | 📄     | [procedure](../identity-and-sso/PRODUCTION-CLIENT-REGISTRATION.md) written; carried out by Dawit on the server at the first deployment                               |
| L-07 | Re-authentication for sensitive actions                                      | P2  | ✅     | built, tested, and proven in a real browser against the SSO 2026-11-14. The web app's part is R-07                                                                   |

## Epic 3: Security and tenancy (Dawit)

| ID   | Task                                                                    | Pri | Status | Acceptance / note                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------- | --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L-08 | RLS, role/permission model, audit chain with tests                      | P0  | ✅     | `npm test` incl. attack tests passes                                                                                                                                     |
| L-09 | Off-box audit checkpoint/shipping                                       | P1  | 🟡     | built and tested: a full rewrite by a database insider is detected ([AUDIT](../security/AUDIT.md)). Open: the second place and the daily job need the test server (D-04) |
| L-10 | Threat model review at each phase gate; penetration test before go-live | P1  | 🟡     | gate M0 review done 2026-11-14, no open critical or high finding ([log](../security/THREAT-MODEL.md#review-log)). Open: reviews at M3 and M4; the penetration test at M5 |

## Epic 4: Repository and application foundation (Dawit)

| ID   | Task                                                      | Pri | Status | Acceptance / note                                                                                                                                                                                                                               |
| ---- | --------------------------------------------------------- | --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-11 | Monorepo, scaffolds, ownership map, CODEOWNERS, templates | P0  | ✅     | merged (pull requests 1 and 2), released as v0.1                                                                                                                                                                                                |
| L-12 | Apply branch protection and GitHub security settings      | P0  | 🟡     | active on `main` and `develop`: pull request required, the two CI checks required, no force push, no deletion; secret scanning and push protection on. Open (owner's click): auto-delete of merged branches, and nine merged branches to delete |

## Epic 5: Database

| ID   | Task                                                               | Pri | Status | Acceptance / note                                                                   |
| ---- | ------------------------------------------------------------------ | --- | ------ | ----------------------------------------------------------------------------------- |
| L-13 | Platform schema, roles, migrations, seed, backup/restore rehearsal | P0  | ✅     | `db:reset` works; restore rehearsal verified, again on 2026-11-14 with the manifest |
| H-01 | Module and table boundary plan with Dawit                          | P0  | ✅     | `docs/api/MODULE-PLAN.md`, approved                                                 |

## Epic 6: DevOps and CI/CD (Dawit)

| ID   | Task                                                                           | Pri          | Status | Acceptance / note                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------ | ------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-14 | CI: lint, types, tests with real PostgreSQL, build, audit, secret scan, CodeQL | P0           | ✅     | green on every pull request since the foundation                                                                                                                                                                     |
| L-15 | Test/UAT environment (host decision D-04), deployment runbook rehearsal        | P1           | 🟡     | deployment, rollback and restore rehearsed on the mirror 2026-11-14 ([record](../devops/DEPLOYMENT-AND-ROLLBACK.md)); one defect found and fixed. Open: the test server itself does not exist (D-04)                 |
| L-16 | Monitoring and log shipping hookup                                             | P2           | 🟡     | scrape job and seven alert rules in `infra/monitoring`, proven against a throwaway Prometheus 2026-11-14 (scrape, queries, rules load). Open: the Group has no Prometheus, alert receiver or log store to connect to |
| L-17 | Production secrets provider (D-05)                                             | P0 for pilot | ✅     | ADR-0007 accepted; key-file provider with rotation built, tested and used in real starts 2026-11-14 ([SECRETS-AND-KEYS](../devops/SECRETS-AND-KEYS.md)). First use on a server is the first deployment               |

## Epic 7: Postiz operational engine (Woluman)

| ID   | Task                                                                                                | Pri            | Status | Acceptance                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------- | -------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| W-01 | Run Postiz locally; assessment report                                                               | P0             | ⬜     | `docs/engine/POSTIZ-ASSESSMENT.md` answers the open questions                                              |
| W-02 | Benchmark report vs Hootsuite, Sprout Social, Buffer                                                | P1             | ⬜     | gap list and cost comparison                                                                               |
| W-03 | Prove the adapter against a live Postiz with a test account                                         | P0             | ⬜     | list, publish, list posts, delete work; results recorded                                                   |
| W-04 | Developer-app registrations and per-network integration notes                                       | P0 (long lead) | ⬜     | `docs/integrations/<network>.md` for all six                                                               |
| W-05 | Bypass prevention and reconciliation design                                                         | P0             | ⬜     | design approved by Dawit. Must also settle publish keys left `in_progress` or `unknown` (review point O-1) |
| W-06 | Analytics mapping, media upload                                                                     | P1             | ⬜     | adapter methods tested                                                                                     |
| W-07 | Postiz admin SSO feasibility and host sizing                                                        | P1             | ⬜     | written recommendation                                                                                     |
| W-08 | Unified inbox in the Postiz fork (`DawitBK/postiz-app`): comments/messages read + reply per network | P0             | ⬜     | endpoints under `/public/v1/inbox`, proven on a test account; fake engine first for Hirko/Rahel            |
| W-09 | Provision Postiz on WSL2 Ubuntu + Docker (separate from the DCC processes)                          | P1             | ⬜     | runs from the fork, restarts after reboot, reachable only by the DCC server                                |
| H-05 | DB idempotency store, publishing records, freeze flag                                               | P1             | ✅     | merged; the gate runs on real data, tested                                                                 |

## Epic 8: Frontend (Rahel)

| ID   | Task                                                                                                                  | Pri | Status     | Acceptance / note                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------- | --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | Short UX direction from existing Group UIs (a page, not a project; D-13)                                              | P0  | ⬜         | `docs/design/UX-DIRECTION.md`                                                                                                                                                            |
| R-02 | ~~Interactive HTML prototype~~ **Dropped (D-13): no Figma, no prototype phase.** Build the real screens directly      | P0  | ⛔ dropped | replaced by R-04 and R-06                                                                                                                                                                |
| R-03 | Components in the app (forms, tables, calendar, status chips, dialogs)                                                | P0  | ⬜         | reusable components using the design tokens, a11y notes. Split the 2,391-line workspace file (review of pull request 25)                                                                 |
| R-04 | App shell on real `/api/me`: navigation, company switcher, role-based home                                            | P0  | 🟡         | in pull request 25, reviewed 2026-11-14, five changes asked for before merge; the `/dcc/dcc/dashboard` redirect was reproduced on a build of the branch (404 after sign-in under `/dcc`) |
| R-06 | Real screens for each module as the backend endpoints land (dashboard, accounts, approvals, publishing, inbox, audit) | P0  | 🟡         | companies, brands and accounts read the API in pull request 25; content, approvals, people and analytics still show sample data                                                          |
| R-07 | Handle `reauth_required`: send the person to sign in again and return (contract in `docs/api/README.md`)              | P1  | ⬜         | the three sensitive actions work from the screens after a 16-minute wait                                                                                                                 |
| R-05 | Nonce-based CSP for the web app                                                                                       | P1  | ⬜         | reviewed by Dawit                                                                                                                                                                        |

## Epic 9: Backend modules (Hirko)

| ID   | Task                                                                                                                                                                        | Pri | Status | Acceptance / note                                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-02 | Social account registry (ownership, backup admin, assignment, status)                                                                                                       | P0  | ✅     | merged, reviewed; endpoints + audit + attack tests                                                                                                                                     |
| H-03 | User and membership administration                                                                                                                                          | P0  | ✅     | merged, reviewed; grant/revoke within scope, audited, role-scope respected; first role by email added by the architect 2026-11-14                                                      |
| H-04 | Content and approval workflow; `ApprovalVerifier`                                                                                                                           | P0  | ✅     | merged, reviewed; one high finding fixed in review (nobody decides on a post they wrote any version of)                                                                                |
| H-06 | Incidents, analytics aggregation, notifications                                                                                                                             | P1  | 🟡     | incidents, operations overview and in-app notifications merged and reviewed (first cut). Open: follower and reach figures need the engine (W-06); incident detail per team document 4B |
| H-07 | OpenAPI docs and API contract notes                                                                                                                                         | P1  | 🟡     | `docs/api/` has a page per module; keep it current with each change                                                                                                                    |
| H-08 | Review follow-ups: refuse removing the last group administrator; no publish request without an approver; one shared "system check" helper; company rename, suspend, archive | P1  | ⬜     | review points O-2, O-3, O-4 and answer 7                                                                                                                                               |
| H-09 | Approval policy as data: policy table and content category, managed with `approval_policy.manage`                                                                           | P0  | ⬜     | mechanism built and tested; rules loaded only from the signed matrix (A-05)                                                                                                            |
| H-10 | Security center endpoint `GET /api/security/posture`: only signals DCC really has, the rest listed as not monitored                                                         | P1  | ⬜     | review answer 5                                                                                                                                                                        |

## Epic 10: Requirements and data discovery (Abenezer)

| ID   | Task                                                                                       | Pri | Status | Acceptance                               |
| ---- | ------------------------------------------------------------------------------------------ | --- | ------ | ---------------------------------------- |
| A-01 | Group and subsidiary structure                                                             | P0  | ⬜     | complete, stored privately               |
| A-02 | Social media account inventory                                                             | P0  | ⬜     | every account, all fields, no passwords  |
| A-03 | Stakeholder and user inventory                                                             | P1  | ⬜     | stored privately                         |
| A-04 | Current-state process documentation                                                        | P1  | ⬜     | `docs/requirements/CURRENT-PROCESSES.md` |
| A-05 | Approval matrix and publishing policy requirements                                         | P0  | ⬜     | signed off by the Group marketing lead   |
| A-06 | Requirements and decisions register; close PROPOSAL-REVIEW items                           | P0  | ⬜     | register current; open items have owners |
| A-07 | Confirm assumption ASM-12 (who reads and who replies in the inbox) with the marketing lead | P1  | ⬜     | written answer in the register           |

## Epic 11: Testing and security verification

| ID   | Task                                                                     | Pri | Status | Acceptance / note                                                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------ | --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-18 | Integration test plan across web, API, engine; UAT scripts with Abenezer | P1  | 🟡     | [plan](../testing/INTEGRATION-TEST-PLAN.md) (36 tests) and [scripts per role](../testing/UAT-SCRIPTS.md) written; section A (sign-in, 11 tests) scripted and run in a real browser 2026-11-14: all passed. Open: the screen tests need the screens; engine tests need Postiz; UAT needs the test server |
| L-19 | Accessibility and usability tests (6-8 users)                            | P1  | 📄     | [plan](../testing/ACCESSIBILITY-AND-USABILITY-TEST-PLAN.md) written; not run, waits for connected screens                                                                                                                                                                                               |

## Epic 12: Pilot and rollout (Dawit, everyone)

| ID   | Task                                                               | Pri | Status | Acceptance / note                                                                                                                      |
| ---- | ------------------------------------------------------------------ | --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| L-20 | Training approach and materials (`docs/training`)                  | P2  | 🟡     | approach and [role guides](../training/ROLE-GUIDES.md) written. Open: click-by-click steps and screenshots per screen; no session held |
| L-21 | Pilot plan: head office plus one or two companies (`docs/rollout`) | P2  | 🟡     | [plan](../rollout/PILOT-PLAN.md) written, Corporate first (D-16). Open: Abenezer confirms the second company                           |
| L-22 | Company onboarding checklist executed per company                  | P2  | 📄     | [checklist with evidence](../rollout/COMPANY-ONBOARDING-CHECKLIST.md) ready; no company onboarded                                      |

## What only the owner can do (not tasks for the team)

| What                                                                                        | Why it waits for the owner                                                                     |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Provide the test server (D-04)                                                              | unblocks L-06, L-09, L-15, L-16, most of L-18                                                  |
| Legal input on data protection (D-15)                                                       | outside the team                                                                               |
| Turn on "automatically delete head branches" and delete the nine merged branches            | repository settings                                                                            |
| Start the network developer-app applications with the company's legal details (W-04)        | long lead time; needs company documents                                                        |
| SSO: let the sign-out page return to a client on another address (its `form-action` policy) | the SSO is a separate system with its own release; development only, production is one address |
| SSO mirror: its licence expired on 2026-11-05, so the mirror SSO is read-only               | renewing a licence is the owner's act                                                          |

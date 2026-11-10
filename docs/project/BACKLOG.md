# Backlog

Owner: Dawit. Source of truth for status is GitHub Issues (create one per row, copy the ID into the title: `[H-03] ...`). This file is the starting set.
Priority: **P0** blocks others or is security-critical, **P1** needed for the pilot, **P2** later. Status: ✅ done · 🟡 in this foundation PR · ⬜ not started.
Every task follows the [Definition of Done](DEFINITION-OF-READY-AND-DONE.md). Dependencies are drawn in [DEPENDENCIES](DEPENDENCIES.md). No task assumes a business decision that has not been recorded in [OPEN-DECISIONS](OPEN-DECISIONS.md).

## Epic 1: Architecture and technical design (Dawit)

| ID   | Task                                                   | Pri | Status | Acceptance                                              |
| ---- | ------------------------------------------------------ | --- | ------ | ------------------------------------------------------- |
| L-01 | Architecture, diagrams, ADRs                           | P0  | ✅     | docs/architecture complete and consistent with the code |
| L-02 | Review and approve the module boundary plan from Hirko | P0  | ⬜     | `docs/api/MODULE-PLAN.md` approved                      |
| L-03 | Resolve open decisions D-01..D-20                      | P0  | ⬜     | each has an answer or a dated owner                     |

## Epic 2: Identity and SSO (Dawit)

| ID   | Task                                                                         | Pri | Status | Acceptance                                 |
| ---- | ---------------------------------------------------------------------------- | --- | ------ | ------------------------------------------ |
| L-04 | OIDC sign-in, sessions, back-channel logout against the existing SSO         | P0  | ✅     | verified in a real browser against dev SSO |
| L-05 | Confirm MFA enforcement and passkeys for privileged roles with the SSO owner | P0  | ⬜     | written answer in docs/identity-and-sso    |
| L-06 | Register the production client (HTTPS, real secret)                          | P1  | ⬜     | login works in the test environment        |
| L-07 | Re-authentication for sensitive actions                                      | P2  | ⬜     | needs SSO `max_age`/`acr` support          |

## Epic 3: Security and tenancy (Dawit)

| ID   | Task                                                                    | Pri | Status | Acceptance                                       |
| ---- | ----------------------------------------------------------------------- | --- | ------ | ------------------------------------------------ |
| L-08 | RLS, role/permission model, audit chain with tests                      | P0  | ✅     | `npm test` incl. attack tests passes             |
| L-09 | Off-box audit checkpoint/shipping                                       | P1  | ⬜     | tamper by a privileged insider detectable (D-06) |
| L-10 | Threat model review at each phase gate; penetration test before go-live | P1  | ⬜     | no open critical/high findings                   |

## Epic 4: Repository and application foundation (Dawit)

| ID   | Task                                                      | Pri | Status | Acceptance                          |
| ---- | --------------------------------------------------------- | --- | ------ | ----------------------------------- |
| L-11 | Monorepo, scaffolds, ownership map, CODEOWNERS, templates | P0  | 🟡     | merged via the foundation PR        |
| L-12 | Apply branch protection and GitHub security settings      | P0  | ⬜     | rules from BRANCH-PROTECTION active |

## Epic 5: Database

| ID   | Task                                                               | Pri | Status | Acceptance                                   |
| ---- | ------------------------------------------------------------------ | --- | ------ | -------------------------------------------- |
| L-13 | Platform schema, roles, migrations, seed, backup/restore rehearsal | P0  | ✅     | `db:reset` works; restore rehearsal verified |
| H-01 | Module and table boundary plan with Dawit                          | P0  | ⬜     | `docs/api/MODULE-PLAN.md`                    |

## Epic 6: DevOps and CI/CD (Dawit)

| ID   | Task                                                                           | Pri          | Status | Acceptance                            |
| ---- | ------------------------------------------------------------------------------ | ------------ | ------ | ------------------------------------- |
| L-14 | CI: lint, types, tests with real PostgreSQL, build, audit, secret scan, CodeQL | P0           | 🟡     | green on the foundation PR            |
| L-15 | Test/UAT environment (host decision D-04), deployment runbook rehearsal        | P1           | ⬜     | deploy and rollback rehearsed         |
| L-16 | Monitoring and log shipping hookup                                             | P2           | ⬜     | OBSERVABILITY "not done" list cleared |
| L-17 | Production secrets provider (D-05)                                             | P0 for pilot | ⬜     | ADR-0007 accepted and implemented     |

## Epic 7: Postiz operational engine (Woluman)

| ID   | Task                                                          | Pri            | Status | Acceptance                                                    |
| ---- | ------------------------------------------------------------- | -------------- | ------ | ------------------------------------------------------------- |
| W-01 | Run Postiz locally; assessment report                         | P0             | ⬜     | `docs/engine/POSTIZ-ASSESSMENT.md` answers the open questions |
| W-02 | Benchmark report vs Hootsuite, Sprout Social, Buffer          | P1             | ⬜     | gap list and cost comparison                                  |
| W-03 | Prove the adapter against a live Postiz with a test account   | P0             | ⬜     | list, publish, list posts, delete work; results recorded      |
| W-04 | Developer-app registrations and per-network integration notes | P0 (long lead) | ⬜     | `docs/integrations/<network>.md` for all six                  |
| W-05 | Bypass prevention and reconciliation design                   | P0             | ⬜     | design approved by Dawit                                      |
| W-06 | Analytics mapping, media upload                               | P1             | ⬜     | adapter methods tested                                        |
| W-07 | Postiz admin SSO feasibility and host sizing                  | P1             | ⬜     | written recommendation                                        |
| H-05 | DB idempotency store, publishing records, freeze flag         | P1             | ⬜     | gate runs on real data                                        |

## Epic 8: Frontend (Rahel)

| ID   | Task                                                                       | Pri | Status | Acceptance                                                                           |
| ---- | -------------------------------------------------------------------------- | --- | ------ | ------------------------------------------------------------------------------------ |
| R-01 | UX direction from existing Group UIs and the sample dashboard              | P0  | ⬜     | `docs/design/UX-DIRECTION.md`                                                        |
| R-02 | Interactive HTML prototype of the whole experience                         | P0  | ⬜     | all screens in the proposal's list, real navigation and workflows, approved by Dawit |
| R-03 | Design system and components                                               | P1  | ⬜     | tokens, components, a11y notes                                                       |
| R-04 | App shell on real `/api/me`: navigation, company switcher, role-based home | P1  | ⬜     | works for each role in a real browser                                                |
| R-05 | Nonce-based CSP for the web app                                            | P1  | ⬜     | reviewed by Dawit                                                                    |

## Epic 9: Backend modules (Hirko)

| ID   | Task                                                                  | Pri | Status | Acceptance                                               |
| ---- | --------------------------------------------------------------------- | --- | ------ | -------------------------------------------------------- |
| H-02 | Social account registry (ownership, backup admin, assignment, status) | P0  | ⬜     | endpoints + audit + attack tests                         |
| H-03 | User and membership administration                                    | P0  | ⬜     | grant/revoke within scope, audited, role-scope respected |
| H-04 | Content and approval workflow; `ApprovalVerifier`                     | P0  | ⬜     | creator cannot approve own content; versions; history    |
| H-06 | Incidents, analytics aggregation, notifications                       | P1  | ⬜     | per team document 4B                                     |
| H-07 | OpenAPI docs and API contract notes                                   | P1  | ⬜     | `docs/api/` current                                      |

## Epic 10: Requirements and data discovery (Abenezer)

| ID   | Task                                                             | Pri | Status | Acceptance                               |
| ---- | ---------------------------------------------------------------- | --- | ------ | ---------------------------------------- |
| A-01 | Group and subsidiary structure                                   | P0  | ⬜     | complete, stored privately               |
| A-02 | Social media account inventory                                   | P0  | ⬜     | every account, all fields, no passwords  |
| A-03 | Stakeholder and user inventory                                   | P1  | ⬜     | stored privately                         |
| A-04 | Current-state process documentation                              | P1  | ⬜     | `docs/requirements/CURRENT-PROCESSES.md` |
| A-05 | Approval matrix and publishing policy requirements               | P0  | ⬜     | signed off by the Group marketing lead   |
| A-06 | Requirements and decisions register; close PROPOSAL-REVIEW items | P0  | ⬜     | register current; open items have owners |

## Epic 11: Testing and security verification

| ID   | Task                                                                     | Pri | Status | Acceptance                  |
| ---- | ------------------------------------------------------------------------ | --- | ------ | --------------------------- |
| L-18 | Integration test plan across web, API, engine; UAT scripts with Abenezer | P1  | ⬜     | scripts per role            |
| L-19 | Accessibility and usability tests (6-8 users)                            | P1  | ⬜     | issues fixed before go-live |

## Epic 12: Pilot and rollout (Dawit, everyone)

| ID   | Task                                                               | Pri | Status | Acceptance                    |
| ---- | ------------------------------------------------------------------ | --- | ------ | ----------------------------- |
| L-20 | Training approach and materials (`docs/training`)                  | P2  | ⬜     | role-based guides             |
| L-21 | Pilot plan: head office plus one or two companies (`docs/rollout`) | P2  | ⬜     | pilot companies chosen (D-16) |
| L-22 | Company onboarding checklist executed per company                  | P2  | ⬜     | checklist signed per company  |

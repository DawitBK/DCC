# Milestones

Owner: Dawit. Last updated 2026-11-14. **No calendar dates are set here:** the project lead sets them. The proposal plans eight
weeks to go-live; the team document defines five phases. This maps the gates. The honest reading today: the software is ahead
of the plan and the things outside the team (a server, a running Postiz, the networks' approvals, the signed approval matrix)
are what decide the date.

| Gate                           | Phase (team document) | Exit criteria                                                                                                                               | State on 2026-11-14                                                                                                                                                              |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0 Foundation**              | 1                     | Repository, ownership, CI, identity, tenancy, audit, engine interface, onboarding tasks ready                                               | **Passed.** Released as v0.1; threat model reviewed at the gate with no open critical or high finding                                                                            |
| **M1 Discovery done**          | 1                     | Group structure, account inventory (private), stakeholders, current processes, approval matrix and policy signed off                        | Not started (Abenezer: A-01 to A-06). **This is now the item furthest behind**                                                                                                   |
| **M2 Design approved**         | 2                     | Screens tested and approved (no prototype phase, D-13); module plan approved; Postiz assessment and adapter proven live; decisions answered | Partly. Module plan approved; all twenty decisions answered; first real screens in review (pull request 25). Open: Postiz assessment and live proof (W-01, W-03), usability test |
| **M3 Foundation live in test** | 3                     | Test environment with SSO login, registry, memberships, audit working; production secrets approach decided                                  | Software ready: registry, memberships, audit, secrets provider, deployment and rollback rehearsed on the mirror. **Blocked: there is no test server (D-04)**                     |
| **M4 Release 1 in UAT**        | 3-4                   | Approval workflow, publishing through Postiz for the first networks, registry, audit, reports demonstrated end to end                       | Backend built and reviewed against the fake engine; UAT scripts written. Open: screens connected, a real Postiz, one network approved, the test server                           |
| **M5 Security cleared**        | 4                     | Penetration test and incident simulation: no open critical/high findings; audit chain verified; tenant isolation re-tested                  | Not started. Tenant isolation is tested on every pull request; the penetration test needs the test server                                                                        |
| **M6 Pilot and go-live**       | 5                     | UAT signed, training delivered, runbooks accepted, rollback rehearsed; pilot companies onboarded                                            | Not started. Pilot plan, onboarding checklist, training approach and runbooks are written                                                                                        |

## What decides the date now (in order)

1. **The test server (D-04).** Without it M3, M5 and most of M4 cannot be passed, whatever the team builds.
2. **Postiz running and proven (W-01, W-03, W-09)** and **network approvals (W-04)**: the long lead items. W-04 should have started already.
3. **Discovery (A-01 to A-06)**: the account inventory and the signed approval matrix are inputs to the pilot, not paperwork.
4. **Screens connected to the API (R-06, R-07).**

Release 2 (TikTok and X, if their approvals arrive; AI monitoring) follows the proposal's plan and depends on external approvals.

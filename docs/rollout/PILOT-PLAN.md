# Pilot plan (L-21)

Owner: Dawit. Decision D-16: start with **Corporate** (the head office, which has the Group's marketing and communications
department), then add **one** more company, chosen by readiness. Abenezer confirms the second company.

**State on 2026-11-14: a plan. Nothing here has started.** No calendar dates are given on purpose: the pilot starts when its
entry conditions are met, and two of them (the network approvals and the server) are not in the team's hands.

## What the pilot must prove

1. The Group's real people can do their real work in DCC: write, approve, publish, and find out who did what.
2. The controls hold with real users: nobody approves their own words, nothing unapproved goes out, one company cannot see another.
3. Operations work: sign-in through the SSO with two factors, backups, the audit checkpoint, a freeze used for real at least
   once (as a drill).
4. The team learns what is confusing **before** every company is on it.

It is not there to prove that every network works. The pilot runs on the networks that are approved by then.

## Scope

| In the pilot                                                                                             | Not in the pilot                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Corporate: its marketing and communications team, its approvers, one administrator                       | every other company (they keep working as they do today)           |
| A second company, added after two clean weeks of Corporate                                               | networks whose developer-app approval has not arrived (RK-01)      |
| Account registry for **all** of the pilot companies' official accounts, including ones not yet connected | AI monitoring (Release 2)                                          |
| Content, approval, publishing, freeze, incidents, audit, notifications, reports                          | the unified inbox, unless W-08 is proven on a test account by then |
| 10 to 20 people in total                                                                                 | scheduling features that depend on parts of Postiz not yet proven  |

## Choosing the second company

Abenezer scores each candidate; the highest ready one goes second. A company that is not ready waits: readiness beats size.

| Criterion                                                                                                 | Why                                             |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Its account inventory is complete: every account has a known owner and a backup administrator             | DCC cannot govern an account nobody can recover |
| A named sponsor in the company who will insist that posts go through DCC                                  | without one, people keep posting directly       |
| A named company administrator and at least one creator, one approver, one publisher, all different people | separation of duties needs three people         |
| Its networks are among the approved ones                                                                  | otherwise there is nothing to publish to        |
| It posts often enough (several times a week) to learn something in two weeks                              |                                                 |

Candidates per D-16: one of the two factories, or Equipment.

## Entry conditions (all must be true before the first real account is connected)

- [ ] Milestone M5: security cleared. Penetration test done; no open critical or high finding; threat model reviewed at the gate.
- [ ] The test server exists and release 1 passed UAT on it ([UAT scripts](../testing/UAT-SCRIPTS.md)).
- [ ] The production server runs DCC behind HTTPS at `/dcc`; the deployment and the rollback were rehearsed **on that server**.
- [ ] DCC is registered in the live SSO; two-factor sign-in is required for it; the first group administrator is set.
- [ ] The Postiz adapter is proven against a live Postiz with a test account (W-03); bypass prevention is in place (W-05).
- [ ] At least one network's developer-app approval has arrived (W-04).
- [ ] The key file, the 4-hourly backup and the daily audit checkpoint run on the server; a restore was rehearsed.
- [ ] The approval matrix is signed by the Group marketing lead (A-05), and the publishing policy says posts go through DCC.
- [ ] Everyone in the pilot has an authenticator app set up and attended their session ([training](../training/README.md)).
- [ ] A way to reach support is announced, with a named person each working day.

## Stages

| Stage                               | Length         | What happens                                                                                            | Moves on when                                                                  |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 0. Dry run                          | 3 working days | Corporate's team does its real week's posts in DCC **on the test server**, with test accounts           | every post went through write, approve, publish without help from the team     |
| 1. Corporate, one account           | 1 week         | [onboarding checklist](COMPANY-ONBOARDING-CHECKLIST.md) for Corporate; one real account connected first | 5 real posts published through DCC; no severity-1 problem                      |
| 2. Corporate, all approved accounts | 2 weeks        | the rest of Corporate's accounts on approved networks; one freeze drill; one incident drill             | two clean weeks: every post through DCC, audit complete, no bypass             |
| 3. Second company                   | 2 weeks        | onboarding checklist for it; the first real test of company separation with real people                 | as stage 2, and nobody saw anything of the other company                       |
| 4. Review and decision              | 2 days         | the measures below, the list of problems, the users' own words                                          | Dawit and the Group marketing lead decide: roll out, extend the pilot, or stop |

Hypercare (a named person watching every working day, problems answered the same day) covers all of stages 1 to 3 and the
first 30 days of each company that joins afterwards.

## What is measured

| Measure                                                                                       | Where it comes from                                 | Target                         |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------ |
| Posts published through DCC, as a share of all posts on the connected accounts                | publications in DCC against the accounts' own feeds | 100%; every bypass is examined |
| Time from "sent for approval" to a decision                                                   | approval request and decision times                 | agreed with marketing in A-05  |
| Posts rejected or sent back, and why                                                          | decisions and comments                              | no target; it is learning      |
| Refusals by the system (not approved, own content, frozen), and whether the person understood | audit events and what people tell support           | understood without a call      |
| Publications with an unknown outcome                                                          | audit action `publication.outcome_unknown`          | each one settled within a day  |
| Support questions per person per week                                                         | support log                                         | falling after week 1           |
| Sign-in problems (no authenticator, lost phone)                                               | `auth.login_failed` reasons                         | none after onboarding          |
| Audit chain and checkpoints                                                                   | daily `verify`                                      | agree every day                |

## Stop conditions (pause the pilot the same day)

- Anything is published that was not approved, or was approved by someone who wrote it.
- A person sees another company's data.
- The audit chain breaks or a checkpoint does not match.
- A real account is lost, locked or taken over.

Pause means: freeze publishing in DCC, tell the companies to post as they did before, find the cause, fix and re-test before
resuming. A pause is not a failure of the pilot; hiding one would be.

## Going back

Until a company is fully on DCC it can return to posting directly at any time: DCC never holds the account passwords, so
nothing has to be handed back. Disconnect the account in Postiz, mark it disconnected in the registry, keep the records.

## Roles in the pilot

| Who      | Does                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| Dawit    | owns the plan and the decisions; security review; deployment; countersigns readiness |
| Abenezer | inventory, approval matrix, onboarding checklist, UAT, support log, measures         |
| Hirko    | fixes in the backend modules; access and approval configuration                      |
| Woluman  | connects accounts through the official authorisation; Postiz; reconciliation         |
| Rahel    | fixes in the screens; demonstrates in training; usability findings                   |

## After the pilot

All companies, a few at a time, each with its own onboarding checklist and 30 days of hypercare; then handover to Group IT
with the runbooks ([deployment](../devops/DEPLOYMENT-AND-ROLLBACK.md), [backup](../devops/BACKUP-AND-RECOVERY.md),
[secrets](../devops/SECRETS-AND-KEYS.md), [monitoring](../devops/OBSERVABILITY.md), [audit](../security/AUDIT.md)).

# Architect's review: backend modules and module plan (L-02)

Reviewer: Dawit (architect). Date: 2026-11-13 and 2026-11-14. Reviewed: everything merged from Hirko between the v0.1 release and
`main` at `5b72fe2` (66 files, about 7,200 lines: the module plan, four migrations, nine modules, twelve test files), against the
[technical review checklist](../TECHNICAL-REVIEW-CHECKLIST.md).

**Result: the module plan is approved, and the code is accepted with the five fixes below, which are already made.**
The open points in section 4 are tasks with owners, not blockers.

## 1. What was checked and how

| Area                                 | How it was checked                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Company isolation on every new table | read each migration: `company_id`, row-level security on, policies, grants; attack tests exist      |
| Approval gate                        | read `approval-verifier.ts`, `publications.service.ts`, `governed.ts`; wrote attack tests           |
| Separation of duties                 | read `approvals.service.ts` and `content.service.ts` together; wrote attack tests                   |
| Access administration                | read `access-governance.service.ts`; existing tests cover self-grant and scope                      |
| Audit                                | every state-changing path checked for an audit event in the same transaction                        |
| Platform code touched                | `platform/audit/audit.service.ts` (new action names only) and `platform/database/schema.ts` (types) |
| The whole suite                      | 194 tests passed before the review; 227 pass after it (11 contracts, 13 engine client, 203 backend) |

## 2. What is good (keep doing this)

- Every new company table has `company_id`, row-level security, policies and the smallest grants that work. No `DELETE` grant where
  state is kept by status. Versions and decisions are insert-only.
- Every service follows the worked example: `TenantDb.run`, the record is loaded under row-level security, `authz.can` is re-checked
  for that company, the audit event is written last in the same transaction.
- A foreign record answers 404, not 403, so nobody can probe for what exists in another company.
- The approval verifier trusts nothing from the caller: it looks up the item, the version, the channel, the target and the approval
  itself, and an older approved version does not pass after an edit.
- A double click on "publish" produces one publication row and one call to the engine (tested, including two requests at once).
- Self-grant is refused even where the role table would allow it.
- The `postiz` engine is refused until the adapter has been proven against a live Postiz. Correct: honest about what is verified.
- Twelve test files, with attack tests for each module.

## 3. Findings, all fixed in this review

Each one has a test that failed before the fix: `portal/backend/test/lead-review.e2e.test.ts`.

| #   | Severity | Finding                                                                                                                                                                                                                                                                                                                                 | Fix                                                                                                                                                                                                      |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | **High** | **A person could approve their own words.** The check compared the approver only with the person who first created the item. Anyone with `content.create` may edit an item, so a marketing manager could rewrite a colleague's draft (a new version), submit it and approve it. The item's first author was someone else, so it passed. | Nobody who wrote **any** version of an item may review, approve or reject it (`assertNotAnAuthor` in `platform/authz/authz.ts`, called from `approvals.service.ts`).                                     |
| F-2 | Medium   | **Group-level reviewers were never notified** when a company-level person acted. The service picked recipients by reading `memberships` as the actor, and row-level security shows a company-level person only their own company's memberships. No error, just no notification.                                                         | New database function `notification_recipients` (migration `202611131000`): answers only for a company the caller may touch, returns user ids only, covers the company and its own group.                |
| F-3 | Medium   | **Posts could be published to an account that is archived or disconnected.** Neither the publish path nor the gate looked at the account's status.                                                                                                                                                                                      | The gate (`ContentApprovalVerifier`) refuses an `archived` or `disconnected` account. It is in the gate, so no caller can skip it.                                                                       |
| F-4 | Medium   | **An unknown publishing outcome left no audit event.** When the engine timed out, a publication row was saved as `pending` but nothing went to the audit trail. That is exactly the case someone will ask about later.                                                                                                                  | New action `publication.outcome_unknown`, written in the same transaction as the row.                                                                                                                    |
| F-5 | Low      | **A published item never said "published".** The status exists in the database, the contract and the reports, but nothing set it: a published item stayed `approved` for ever, so screen, backend and database disagreed.                                                                                                               | A successful publication of the item's current version sets the item to `published`. An edit afterwards makes a new version and returns it to `draft`, as before. The reports test was updated to match. |

Also found while testing, not in Hirko's code: test servers started on port 0 can be given a port that `fetch` refuses to call
("bad port"), which failed one whole test file once. All HTTP test files now start through `listenForTests` in `test/helpers.ts`.

## 4. Open points (tasks, with owners)

| #   | Point                                                                                                                                                                                                                                                                                                        | Owner                | Task            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | --------------- |
| O-1 | A publish that crashes between "started" and "finished" leaves its key `in_progress` for ever, and one that timed out stays `unknown`. Both are refused on retry, which is right, but there is no way yet to settle them. The reconciliation job must clear them from what the engine reports.               | Woluman with Hirko   | W-05            |
| O-2 | An administrator can remove their own last role, and the last group administrator can be removed. Decide the rule (suggested: refuse to remove the last `group_admin` of a group; allow removing your own other roles).                                                                                      | Hirko, Dawit decides | H-08            |
| O-3 | `approverUserId` falls back to the publisher when no approval exists. The gate refuses that request anyway, so nothing wrong is published, but the value is misleading: send no request at all in that case.                                                                                                 | Hirko                | H-08            |
| O-4 | `SYSTEM_USER_ID` and the "system check for one company" context are written twice (verifier and freeze). Move it to one helper in `modules/shared/tenant-scope.ts`.                                                                                                                                          | Hirko                | H-08            |
| O-5 | Approval is checked and the engine is called in separate steps, so an edit made in the same instant as a publish could, in theory, publish the version that was approved a moment earlier. The item version is fixed in the request, so the published text is always an approved text. Acceptable; recorded. | Dawit                | threat model T4 |
| O-6 | `idempotency_keys` rows are never removed. Keep them (they are small and they are evidence), and add a retention rule when the table is large.                                                                                                                                                               | Hirko                | later           |
| O-7 | Old sessions and login attempts are purged on each new sign-in only. Fine at this size; a scheduled purge comes with the first background job.                                                                                                                                                               | Dawit                | later           |

## 5. Answers to the seven questions in the module plan

These are the architect's decisions. Where the owner has not spoken, it is the architect's call under the owner's standing
instruction, and it is marked "call" so it can be overruled.

1. **The seven groups (D-11).** Confirmed as Hirko proposed: Accounts (company management, social account registry), Access,
   Publishing, Approvals, Inbox, Security and audit (security center, activity audit, incidents), Insights (analytics, AI later).
   The Group dashboard is the home page, not a group. Call.
2. **Who may grant roles.** A company administrator may grant and remove any company-level role, including another company
   administrator, inside their own company only, and never a group-level role. Only a person who holds `user.manage` at group level
   may grant a group-level role. Nobody grants themselves anything. This is what the code and the tests already do. Decided.
3. **Approval routing by content category.** Do not build rules from the proposal's table: it is a draft, and the signed matrix is
   Abenezer's task A-05 (decision D-17). Build the **mechanism** next, as data, never as `if` statements: a policy table
   (company, content category, required approver role, number of approvals) managed with the existing `approval_policy.manage`
   permission, and a `category` on the content item. Until A-05 is signed, the only rule in force stays "one approver who did not
   write any version". New task H-09. Call.
4. **Unified inbox.** Two new permissions are approved in principle: `inbox.read` and `inbox.reply`. They are added to
   `portal/contracts` in the same pull request as the first inbox endpoint, with Dawit as reviewer. First mapping (assumption ASM-12,
   Abenezer confirms with the marketing lead): read for marketing managers, executives, publishers and Group marketing; reply for
   marketing managers and publishers. **No thread table in DCC:** the state of a conversation (assigned, answered) lives in the
   Postiz fork (D-12); DCC checks the permission, writes an audit event for every reply and passes the call through. Call.
5. **Security center.** It is a backend endpoint, Hirko's: `GET /api/security/posture`. It reports only what DCC really knows:
   administrators added in the last 30 days (from the audit trail), accounts with no backup administrator or no owner (already in
   `reports/registry-gaps`), publishing freezes in force, open incidents by severity, and whether the audit chain and its
   checkpoints agree. Two-factor sign-in is enforced for everyone at sign-in, so "two-factor compliance" is 100% by construction:
   say that, do not compute it. Token expiry and connection health come from Woluman's adapter when W-03 is done; until then the
   endpoint says `"notMonitored": ["token expiry", "connection health"]`. Never show a signal DCC does not have. New task H-10. Call.
6. **AI intelligence.** Out of scope for this phase (Release 2 in the proposal). No design work and no new service. Decided.
7. **Company update and archive endpoints.** Needed for onboarding a company: rename, suspend, archive (no delete). Small, P1.
   Part of H-08.

## 6. What this review did not cover

- The frontend (Rahel's pull request 25 was reviewed separately, on GitHub).
- The Postiz adapter against a live Postiz (W-03): still never run.
- Load and performance.
- A penetration test (planned before go-live, L-10).

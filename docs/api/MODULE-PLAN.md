# H-01: Module plan

Owner: Hirko. **Status: APPROVED by Dawit on 2026-11-14.** The review, the five fixes it made and the answers to the
seven questions at the end of this file are in
[the architect's review](../project/reviews/2026-11-13-BACKEND-MODULES-REVIEW.md) (section 5 has the answers).
The text below is the plan as Hirko wrote it for the review; where it says "ask Dawit", the answer is in that review.

## Where this came from

Checked against the proposal (`KG-IT-DCC-PRP-001` v1.0, §7.1 Platform Modules, §7.3 Roles and Permissions,
§12.2 Approval Matrix, §9.1 process walkthrough). **The PDF itself is not, and will not be, committed to this
repository** (D-02; the onboarding doc is explicit that the proposal never goes in the project). This file only
paraphrases the business facts needed to build the backend — the same way `portal/contracts/src/permissions.ts`
and `platforms.ts` already cite "proposal §5.3" / "proposal 7.3" in their comments.

Per **D-11**: keep the detailed list (12), present it grouped into seven. The proposal's own executive summary
says "working portal (7 modules)" but its §7.1 table lists 12 — so the 12→7 grouping itself is **not written
down anywhere I can find; it's Dawit's call to make**, not something to guess at. A candidate grouping is
offered below for him to confirm or replace.

## The 12 modules (proposal §7.1, Hirko's reading of each)

| #   | Module (proposal name)  | What it does                                                                             | Primary users               |
| --- | ----------------------- | ---------------------------------------------------------------------------------------- | --------------------------- |
| 1   | Group dashboard         | Consolidated view across companies, accounts, approvals, security posture, activity      | Executives, Group IT, Comms |
| 2   | Company management      | Register subsidiaries, brands, departments; hierarchical tenancy                         | Group admins                |
| 3   | Social account registry | Name, URL, platform, owner, backup admin, status, recovery contact, health score         | Group IT, company admins    |
| 4   | Access governance       | User assignment, roles, permissions, periodic access reviews, leaver revocation          | Group CTO                   |
| 5   | Publishing workspace    | Composer, content calendar, media library, campaign planning, the actual publish action  | Creators, publishers        |
| 6   | Approval management     | Review, approve/reject with comments, evidence, version history                          | Reviewers, approvers        |
| 7   | Unified inbox           | Comments/DMs from all platforms; status, assignment, response-time tracking              | Community managers          |
| 8   | Security center         | MFA compliance, token expiry, new-admin alerts, risk scoring, "unavailable data" notices | Group CTO                   |
| 9   | Activity audit          | Who logged in, posted, edited, deleted, approved, changed configuration                  | Auditors, CTO               |
| 10  | Incident management     | Register, escalate, track, resolve; recovery checklists and contacts                     | CTO, Marketing/Comms        |
| 11  | Analytics and reporting | Followers, reach, engagement, growth; automated monthly executive report                 | Executives, Marketing       |
| 12  | AI intelligence         | Sentiment analysis, brand-mention monitoring, unusual-activity/content-risk alerts       | Comms, Security             |

**A candidate 7-group presentation (unconfirmed — ask Dawit):**

| Group            | Modules inside                                              |
| ---------------- | ----------------------------------------------------------- |
| Accounts         | 2 Company management, 3 Social account registry             |
| Access           | 4 Access governance                                         |
| Publishing       | 5 Publishing workspace                                      |
| Approvals        | 6 Approval management                                       |
| Inbox            | 7 Unified inbox                                             |
| Security & audit | 8 Security center, 9 Activity audit, 10 Incident management |
| Insights         | 11 Analytics and reporting, 12 AI intelligence              |

Build order (real dependencies, backlog Epic 9, not the table order above):

**3 → 4 → 5+6 (the big one) → 7 (needs Woluman's W-08) → 10+11 → 9 (mostly already built) → 8 (partly blocked
on engine data) → 2 (small gap, any time) → 1 (last, aggregates everything) → 12 (ask Dawit first — see below).**

---

## 3. Social account registry

**What it does:** the record of every official social page — owner, backup admin, who is assigned, status,
health. (Backlog H-02.)

**Tables:** already exist, no new migration — `social_accounts`, `account_assignments`.

**Endpoints:** `GET /api/social-accounts` (exists). New: `POST /api/social-accounts`,
`PATCH /api/social-accounts/:id`, `PATCH /api/social-accounts/:id/status`,
`POST /api/social-accounts/:id/assignments`, `DELETE .../assignments/:userId`.

**Permissions:** `account.read`, `account.manage` (already exist). No new permission.

**Depends on:** nothing new.

**Order:** first.

**Not in this cut:** a numeric "health score" (proposal §7.1) — depends on signals (MFA status, token expiry,
recent activity) that mostly live in module 8 (Security center) and the engine. Build the registry first; add
the score once those signals exist. Confirm with Dawit whether a simple score is wanted now or can wait.

---

## 2. Company management

**What it does:** register subsidiaries, brands, departments; hierarchical tenancy.

**Tables:** already exist (`companies`, `brands`) — this is the worked-example module Dawit already built.

**What's already there:** `GET /api/companies`, `POST /api/companies`, `GET /api/companies/:id/brands`,
`POST /api/companies/:id/brands`.

**Gap:** no update/rename/archive endpoints yet (`PATCH /api/companies/:id`, `PATCH /api/brands/:id`,
status changes). Small; low priority.

**Permissions:** `company.read`, `company.manage`, `brand.read`, `brand.manage` (already exist).

**Order:** low effort, any time — confirm with Dawit whether it's worth its own small PR or folds into
another module's PR.

---

## 4. Access governance

**What it does:** list the people a caller may see, grant a role, revoke a role — "a new subsidiary onboarded
in under a day without code changes" (proposal objective #8; backlog H-03).

**Tables:** already exist — `users`, `memberships`.

**Endpoints:** `GET /api/users`, `POST /api/memberships` (grant), `DELETE /api/memberships/:id` (revoke).

**Permissions:** `user.read`, `user.manage` (already exist).

**Depends on:** nothing technical. Blocked on a business decision.

**Order:** second.

**Open question for Dawit (do not guess, per H-03 step 4):** may a company administrator grant roles inside
their own company only, never a group role? Can a company admin grant `company_admin` to someone else? Is there
a safeguard against revoking the last `company_admin` of a company?

---

## 5. Publishing workspace

**What it does:** draft content (every edit makes a new version), and — once approved — actually publish it.
Two halves: drafting (no dependency on the approval matrix) and publishing (needs approval + the engine).

**Tables (new migration, `YYYYMMDDHHMM__content_approvals.sql`, per H-04 step 3):**

- `content_items` — company_id, brand_id, created_by, current_version_id, status, created_at.
- `content_versions` — content_item_id, company_id, version_number, body/media reference, target_account_ids,
  created_by, created_at (immutable once created).
- `publications` — content_version_id, company_id, social_account_id, approved_by, engine_operation_id,
  external_post_url, status, requested_at, completed_at, error.
- `idempotency_keys` — key (unique), state, result, created_at.
- `publishing_freezes` — company_id, channel_id (nullable = whole company), frozen_by, frozen_at, reason
  (proposal FR-15, the emergency freeze switch).

**Endpoints:** `POST /api/content-items`, `PATCH /api/content-items/:id` (new version), `GET /api/content-items`,
`GET /api/content-items/:id/versions`, `POST /api/content-items/:id/publish`, `GET /api/publications`,
`POST /api/publishing-freezes`, `DELETE /api/publishing-freezes/:id`.

**Permissions:** `content.read`, `content.create`, `content.publish`, `publishing.freeze` (already exist).

**Implements:** `IdempotencyStore` and `FreezeCheck` from `portal/engine-client/src/governed.ts` (DB-backed).

**Depends on:** the drafting half needs nothing new and can start now (H-04 steps 1–4). The publish half needs
module 6 (a real approval to check against) and Woluman's W-03 (adapter proven against live Postiz) before it
can be exercised for real — can still be built and tested against the fake engine first.

**Order:** third/fourth, alongside module 6, the biggest single piece of work. Expect 2–3 pull requests.

---

## 6. Approval management

**What it does:** submit a version for review, review it (a genuine separate step — the proposal's own
walkthrough, §9.1, has "Review" and "Approve" as two different steps with two different actors), then approve
or reject, with full evidence and version history. **Separation of duties: the creator can never approve their
own content** (`assertDifferentPeople` in `platform/authz/authz.ts`). A new version always needs a new approval.

**Tables:** same migration as module 5 —

- `approval_requests` — content_version_id, company_id, requested_by, requested_at, status.
- `approval_decisions` — approval_request_id, company_id, decided_by, decision (approve/reject), comment,
  decided_at. (A "review" comment with no decision yet is its own row/state, matching the proposal's separate
  Review step.)

**Endpoints:** `POST /api/content-items/:id/submit`, `POST /api/approval-requests/:id/review` (comment, no
decision), `POST /api/approval-requests/:id/approve`, `POST /api/approval-requests/:id/reject`.

**Permissions:** `content.submit`, `content.review`, `content.approve` (already exist).

**Approval routing (proposal §12.2 — content category → approver):** routine updates → company marketing
manager; campaigns → company marketing manager/communications; Group-level announcements → group marketing;
financial/investor communication → Finance + executive management; crisis/legal/reputational → CEO/COO or
designated executive; sensitive corporate statements → a Group-authorized executive. **This reads like a real
first answer to Abenezer's A-05, but it is not yet a signed-off decision** — the process is still "Abenezer
collects, Dawit approves" (D-17). Build the simple placeholder rule first (H-04 step 7: one reviewer who is
not the creator) with the category routing easy to drop in once A-05 is formally closed, rather than hard-coding
this table from a reading of the proposal.

**`ApprovalVerifier`:** implements the interface in `portal/engine-client/src/governed.ts`.

**Note on ASM-03:** the proposal's own role table (§7.3) does list "publish" for both Content Creator and
Content Reviewer, exactly as ASSUMPTIONS.md's ASM-03 describes — which supports (not settles) that this is the
typo Dawit already decided it is. Still shown as "open, confirm with Abenezer" in the assumptions register; this
isn't mine to close.

**Order:** fourth, with module 5.

---

## 7. Unified inbox

**What it does:** comments/messages per connected account, with reply, through the engine (D-12, Woluman's
`InboxEngine`). DCC does not store the inbox content itself — a thin pass-through with permission checks and an
audit event per reply (`portal/engine-client` CLAUDE.md: replies need permission + an audit event before the
engine is called).

**Tables:** none new by default — ask Dawit before adding any local thread-state cache.

**Endpoints:** `GET /api/social-accounts/:id/inbox`, `POST /api/social-accounts/:id/inbox/:threadId/reply`.

**Permissions:** **none exist yet.** Proposed new `inbox.read` / `inbox.reply` — needs Dawit's review.

**Depends on:** Woluman's W-08 (fake engine first for Hirko/Rahel per the backlog note), module 3.

**Order:** fifth, once W-08's fake engine exists to build against.

---

## 8. Security center

**What it does:** MFA compliance, token expiry, new-admin alerts, risk scoring, and explicit "not monitored"
notices where a platform doesn't expose a signal (proposal: "never present unavailable information as if it
were monitored" — already echoed in ASM/architecture here).

**What's derivable today, no new table:** MFA compliance and new-admin alerts come from `memberships` and
session data (already in `platform/`). Token expiry and connection health belong to the operational engine
(DCC never stores social tokens) — this part is a **read from Woluman's adapter**, not a DCC table.

**Endpoints:** `GET /api/security/posture` (company or group scope).

**Permissions:** `security.read`, `security.manage` (already exist, currently unused by any module).

**Depends on:** modules 4 (for admin-change alerts) and the engine (for token/connection signals) —
**ask Dawit how much of this is Hirko's module vs. a frontend view composed from existing endpoints.**

**Order:** later — mostly reporting over data other modules already produce.

---

## 9. Activity audit

**What it does:** search/export the hash-chained audit log (already Dawit's platform foundation).

**Tables:** already exists, platform-owned, append-only.

**What's already there:** `src/modules/audit/` has a read API. Confirm its current scope before adding — this
may already satisfy most of this module.

**Permissions:** `audit.read` (already exists).

**Order:** ongoing — extend only as other modules need new filters, per H-07.

---

## 10. Incident management

**What it does:** register, escalate, track, resolve an incident; recovery checklists/contacts.

**Tables (new migration):** `incidents` — company_id, social_account_id (nullable), title, description,
severity, status, opened_by, opened_at, resolved_at.

**Endpoints:** `POST /api/incidents`, `PATCH /api/incidents/:id`, `GET /api/incidents`.

**Permissions:** `incident.read`, `incident.manage` (already exist).

**Order:** part of H-06 (later). Can start any time after module 3.

---

## 11. Analytics and reporting

**What it does:** followers/reach/engagement/growth aggregation; automated monthly executive report
(proposal objective #6, FR-11).

**Tables:** likely none new at first — computed from `publications`, `content_items`, `social_accounts`.
Confirm before adding an aggregate table (keep it simple, CLAUDE.md §4).

**Endpoints:** `GET /api/reports/overview`, `GET /api/reports/by-account`.

**Permissions:** `report.read` (already exists).

**Depends on:** modules 3, 5, 6 need real data to report on.

**Order:** part of H-06.

---

## 12. AI intelligence

**What it does:** sentiment analysis, brand-mention monitoring, unusual-activity/content-risk alerts
(proposal FR-10, Release 2 — explicitly lower priority/later than the rest).

**Flag before doing anything here:** this is the one module that plainly needs a new external service (an
"approved LLM and sentiment-analysis service", per the proposal's own tech stack). CLAUDE.md §4: _"The answer
to 'should we add X' is 'ask Dawit'"_ — new infrastructure/dependency needs his sign-off before any design
work, let alone code.

**Order:** last, and only after Dawit confirms it's in scope for this phase.

---

## 1. Group dashboard

**What it does:** consolidated view across companies, accounts, approvals, security posture, activity.

**Tables:** none new — reads across everything above.

**Endpoints:** likely a handful of summary endpoints (`GET /api/dashboard/summary`) that the frontend composes;
mostly Rahel's work (R-04/R-06) once the data exists.

**Order:** last — needs most other modules built first to have anything to summarize.

---

## Summary: what to bring to the 30-minute meeting

1. Confirm or correct the candidate 7-group presentation of the real 12 modules (D-11) — this isn't written
   down anywhere Hirko could find.
2. Access governance (module 4): the role-grant scope question — **blocks H-03 entirely.**
3. Approval management (module 6): proposal §12.2 gives a content-category → approver mapping that reads like
   a draft answer to A-05 — confirm with Abenezer/Dawit whether to build against it now or keep waiting.
4. Unified inbox (module 7): the two new permissions `inbox.read`/`inbox.reply`, and whether DCC needs its own
   thread-state table.
5. Security center (module 8): how much of this is a new backend module vs. a frontend view over existing
   endpoints, and how token-expiry data flows from Woluman's engine.
6. AI intelligence (module 12): confirm it's actually in scope for Hirko to build (new external service
   dependency) before any design work.
7. Company management (module 2): confirm whether the missing update/archive endpoints are needed now.

**Done when:** Dawit approves this plan (pull request review). Nothing beyond the already-existing endpoints
should be built from here until that happens.

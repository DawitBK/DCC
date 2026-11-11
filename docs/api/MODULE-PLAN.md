# H-01: Module plan (draft, for the 30-minute review with Dawit)

Owner: Hirko. **Status: DRAFT, not yet approved.** Nothing in `portal/backend/src/modules/` beyond what already
exists should be built from this file until Dawit has reviewed it and the open questions below have answers.

## Where this came from

The proposal's confidential team document has the authoritative 12-module list and the 4B assignment (D-02: it
never goes in this public repo). This draft does **not** copy it. It is built only from what is already in the
repository: the platform tables (`portal/backend/migrations/202611101000__platform_core.sql`), the permission
catalogue (`portal/contracts/src/permissions.ts`), the architecture doc, the backlog (Epic 9), and the open
assumptions/decisions registers. **Check it word-for-word against the real proposal in the meeting** and correct
anything that does not match.

Per **D-11**: keep the detailed list (12), present it grouped into seven for anyone outside the backend team.

## The seven presentation groups

| # | Group (presented)       | Detailed modules inside it                                  |
| - | ------------------------ | ------------------------------------------------------------ |
| 1 | Accounts & brands        | 1. Social account registry · 2. Brand administration          |
| 2 | People & access          | 3. User & membership administration                          |
| 3 | Content & approvals      | 4. Content drafting & versions · 5. Review & approval workflow |
| 4 | Publishing               | 6. Publishing records & freeze switch                         |
| 5 | Unified inbox            | 7. Inbox (read & reply, through the engine)                   |
| 6 | Incidents & reporting    | 8. Incidents · 9. Analytics & reporting · 10. Notifications    |
| 7 | Security & audit         | 11. Security center · 12. Audit trail (read API)               |

Build order follows the backlog (Epic 9) and real dependencies, not the group numbering above:

**H-02 → H-03 → H-04 → H-05 → (inbox, needs Woluman's W-08) → H-06 (incidents / analytics / notifications) → ongoing: H-07 docs, security/audit extras.**

---

## 1. Social account registry

**What it does:** the record of every official social page — who owns it, the backup admin, who is assigned,
and its status. (H-02.)

**Tables:** already exist, no new migration — `social_accounts` (company_id, brand_id, platform, display_name,
handle, status, owner_user_id, backup_admin_user_id, engine_channel_id), `account_assignments` (social_account_id,
company_id, user_id).

**Endpoints it offers:**
- `GET /api/social-accounts` — exists today (read-only, foundation).
- `POST /api/social-accounts` — create (status defaults to `needs_attention` until an owner is set).
- `PATCH /api/social-accounts/:id` — update display name, handle, brand, backup admin.
- `PATCH /api/social-accounts/:id/status` — change status (audited).
- `POST /api/social-accounts/:id/assignments`, `DELETE /api/social-accounts/:id/assignments/:userId` — assign/unassign a person.

**Permissions it uses:** `account.read`, `account.manage` (both already in `permissions.ts`). No new permission.

**Depends on:** nothing new — companies/brands/users already exist.

**Order:** first. Tables and the read endpoint already exist; this is the natural next step.

**Open questions for Dawit:** none blocking. Confirm the rule "an account must have an owner; backup admin must
be a different person from the owner" (already written into the H-02 task) is still correct.

---

## 2. Brand administration

**What it does:** create/rename/archive a brand inside a company (brands already exist as a table; only
read access exists today via the companies module's joins, if any).

**Tables:** already exists — `brands` (company_id, name, slug, status).

**Endpoints it offers:** `POST /api/brands`, `PATCH /api/brands/:id`, `PATCH /api/brands/:id/status`.

**Permissions it uses:** `brand.read`, `brand.manage` (already exist).

**Depends on:** nothing new.

**Order:** alongside H-02, low effort — confirm with Dawit whether this is in scope now or folds into H-02's PR.

---

## 3. User & membership administration

**What it does:** list the people a caller may see, grant a role, revoke a role, so a new company/person can be
onboarded "in under a day without code changes." (H-03.)

**Tables:** already exist — `users`, `memberships` (user_id, group_id, company_id nullable, role, source).

**Endpoints it offers:** `GET /api/users`, `POST /api/memberships` (grant), `DELETE /api/memberships/:id` (revoke).

**Permissions it uses:** `user.read`, `user.manage` (already exist).

**Depends on:** nothing technical. Blocked on a business decision (below).

**Order:** second, right after H-02.

**Open questions for Dawit (do not guess, per H-03 step 4):**
- May a company administrator grant roles inside their own company only, and never a group role?
- Can a company admin grant `company_admin` to someone else, or is that group-admin-only?
- Does revoking the last `company_admin` of a company need a safeguard (company left with nobody who can manage it)?

---

## 4. Content drafting & versions

**What it does:** create a content item, edit it (every edit makes a new version), see its history. The
content itself (text, target accounts, scheduled time) lives here; approval decisions live in module 5.

**Tables (new migration, `YYYYMMDDHHMM__content_approvals.sql` per H-04 step 3):**
- `content_items` — company_id, brand_id, created_by (user), current_version_id, status (draft/in_review/approved/rejected/published/archived), created_at.
- `content_versions` — content_item_id, company_id, version_number, body/media reference, target_account_ids, created_by, created_at. (A version is immutable once created.)

**Endpoints it offers:** `POST /api/content-items` (draft), `PATCH /api/content-items/:id` (new version),
`GET /api/content-items/:id`, `GET /api/content-items/:id/versions`, `GET /api/content-items` (list, filtered).

**Permissions it uses:** `content.read`, `content.create` (already exist).

**Depends on:** social account registry (module 1) for target accounts. Does **not** need Abenezer's approval
matrix (A-05) — can be built now, per the H-04 instruction to "do the parts that do not depend on it first."

**Order:** third, first half of H-04.

---

## 5. Review & approval workflow

**What it does:** submit a version for review, review it, approve or reject it, with one decision row per
step. Enforces **separation of duties**: the creator can never approve their own content (`assertDifferentPeople`
from `platform/authz/authz.ts`). A new version always needs a new approval.

**Tables (same migration as module 4):**
- `approval_requests` — content_version_id, company_id, requested_by, requested_at, status.
- `approval_decisions` — approval_request_id, company_id, decided_by, decision (approve/reject), comment, decided_at.

**Endpoints it offers:** `POST /api/content-items/:id/submit`, `POST /api/approval-requests/:id/review`
(comment, no decision yet — optional, confirm with Dawit whether "review" is a separate step from "approve"),
`POST /api/approval-requests/:id/approve`, `POST /api/approval-requests/:id/reject`.

**Permissions it uses:** `content.submit`, `content.review`, `content.approve` (already exist). May need
`approval_policy.manage` (already exists) for the "one reviewer who is not the creator" rule to later become
configurable per category.

**Depends on:** module 4. **Waits on Abenezer's A-05** (approval matrix: levels, who approves which category,
time limits) for the real rule. Until A-05 lands, build the placeholder rule from H-04 step 7 (one reviewer who
is not the creator) and keep it easy to replace.

**`ApprovalVerifier`:** this module implements the interface in `portal/engine-client/src/governed.ts` —
given a content version and a channel, answer "is it approved for this channel?" from these tables.

**Order:** fourth, second half of H-04. Likely 2–3 separate pull requests as the task note suggests.

**Open question for Dawit/Abenezer:** is "review" (a comment, no decision) a real separate step, or do
reviewers go straight to approve/reject? The task text implies both "review" and "approve" permissions exist
for a reason — confirm before building a review-without-decision endpoint that nobody asked for.

---

## 6. Publishing records & freeze switch

**What it does:** the real memory the approval door needs: one row per publication attempt, an idempotency
key so a double-click never sends twice, and a freeze switch per company/channel.

**Tables (new migration):**
- `publications` — content_version_id, company_id, social_account_id, approved_by, engine_operation_id,
  external_post_url, status, requested_at, completed_at, error.
- `idempotency_keys` — key (unique), state (in_progress/done/unknown), result, created_at.
- `publishing_freezes` — company_id, channel_id (nullable = whole company), frozen_by, frozen_at, reason.

**Endpoints it offers:** `POST /api/content-items/:id/publish`, `GET /api/publications`,
`GET /api/publications/:id`, `POST /api/publishing-freezes`, `DELETE /api/publishing-freezes/:id`.

**Permissions it uses:** `content.publish`, `publishing.freeze` (already exist).

**Implements:** `IdempotencyStore` and `FreezeCheck` from `portal/engine-client/src/governed.ts` (DB-backed).

**Depends on:** module 5 (needs real approvals to verify against) **and** Woluman's W-03 (the adapter proven
against a live Postiz) before this can be exercised for real — can still be built and tested against the fake
engine first.

**Order:** fifth (H-05).

---

## 7. Unified inbox (read & reply)

**What it does:** show comments/messages per connected account and let an allowed person reply, through the
engine (D-12: built by customising Postiz, Woluman's `InboxEngine`). DCC does **not** store the inbox content
itself — it is a thin pass-through with permission checks and an audit event per reply
(`portal/engine-client` CLAUDE.md: "Replies are public communication: they need permission and an audit event
in the portal before the engine is called").

**Tables:** none new, unless Dawit wants a local audit-friendly cache of thread state — **ask**; default to
no table, call the engine live and audit the reply action only.

**Endpoints it offers:** `GET /api/social-accounts/:id/inbox`, `POST /api/social-accounts/:id/inbox/:threadId/reply`.

**Permissions it uses:** **none exist yet.** Proposed new permissions `inbox.read` / `inbox.reply` —
**needs Dawit's review** (permissions.ts change).

**Depends on:** Woluman's W-08 (fake engine first for Hirko/Rahel, per the backlog note), module 1 (social
account registry, to know which accounts exist).

**Order:** sixth — after publishing, whenever W-08's fake engine is ready to build against.

---

## 8. Incidents

**What it does:** record and track an incident (something went wrong with an account or a post) so it is on
record and can be escalated.

**Tables (new migration):** `incidents` — company_id, social_account_id (nullable), title, description,
severity, status (open/investigating/resolved/closed), opened_by, opened_at, resolved_at.

**Endpoints it offers:** `POST /api/incidents`, `PATCH /api/incidents/:id`, `GET /api/incidents`.

**Permissions it uses:** `incident.read`, `incident.manage` (already exist).

**Depends on:** nothing blocking — can be built any time after module 1.

**Order:** seventh, part of H-06 (later, per the onboarding doc — "details come from section 4B of the team
document and the plan").

---

## 9. Analytics & reporting

**What it does:** aggregate counts (posts published, approvals pending, per-account activity) for dashboards.
Read-only; no new business rules.

**Tables:** likely no new table at first — computed from `publications`, `content_items`, `social_accounts`.
Confirm with Dawit before adding a materialized/aggregate table (keep it simple, per CLAUDE.md section 4).

**Endpoints it offers:** `GET /api/reports/overview`, `GET /api/reports/by-account`.

**Permissions it uses:** `report.read` (already exists).

**Depends on:** modules 1, 4–6 need real data to report on.

**Order:** eighth, part of H-06.

---

## 10. Notifications

**What it does:** tell a person something needs them (a review is waiting, an account needs attention).

**Tables (new migration, if in scope now):** `notifications` — user_id, company_id, type, payload, read_at, created_at.

**Endpoints it offers:** `GET /api/notifications`, `PATCH /api/notifications/:id/read`.

**Permissions it uses:** none of the existing ones fit a "see your own notifications" read — likely no
permission needed (a person always sees their own). **Confirm with Dawit** whether this needs a permission at
all or is scoped by `user_id = caller` only.

**Depends on:** whichever modules raise notifications (approvals, incidents) — build those events first.

**Order:** ninth, part of H-06, lowest priority of the three.

---

## 11. Security center

**What it does:** surface to `security_admin`/`group_cto` the things they're allowed to manage: who holds
`security.manage`-gated settings, and incident oversight. Exact scope is unclear from the code alone.

**Tables:** none identified yet.

**Endpoints it offers:** unclear — **ask Dawit** what "security center" is meant to contain beyond what
modules 3, 8 and 12 already cover. It may turn out to be a frontend view over existing endpoints rather than
a new module.

**Permissions it uses:** `security.read`, `security.manage` (already exist, currently unused by any module).

**Depends on:** unclear until scoped.

**Order:** last — needs scoping with Dawit before any table or endpoint is designed.

---

## 12. Audit trail (read API)

**What it does:** let an `auditor` (or anyone with `audit.read`) see the hash-chained audit log.

**Tables:** already exists and is Dawit's (`platform/audit`) — append-only, hash-chained.

**Endpoints it offers:** a module in `src/modules/audit/` already exists (read API). Confirm its current state
before adding to it — this may already satisfy H-07's documentation need rather than requiring new code.

**Permissions it uses:** `audit.read` (already exists).

**Depends on:** nothing — platform foundation already does the hard part.

**Order:** ongoing; keep `docs/api/` current per H-07 as each module adds endpoints.

---

## Summary: what to bring to the 30-minute meeting

1. Confirm or correct this 12-module breakdown and the 7-group presentation against the real proposal document.
2. Module 3 (people & access): the role-grant scope question (who may grant what) — **H-03 cannot start without this.**
3. Module 5 (approvals): whether "review" is a distinct step from "approve" — affects the endpoint list.
4. Module 7 (inbox): the two new permissions `inbox.read` / `inbox.reply`, and whether DCC needs its own
   thread-state table or stays a pure pass-through.
5. Module 9/10 (reporting/notifications): whether any new tables are wanted now or this waits for H-06.
6. Module 11 (security center): what it actually contains — currently a guess.

**Done when:** Dawit approves this plan (pull request review). Nothing beyond the already-existing social
account registry read endpoint should be built from here until that happens.

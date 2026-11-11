# Content: drafting, versions, approvals, and the ApprovalVerifier (H-04, complete)

Owner: Hirko. All three parts: create a draft, edit it (every edit makes a new, immutable version),
list, read, version history, submit for review, review (a comment), approve, reject, and
`ContentApprovalVerifier` - the implementation of the interface `GovernedEngine` calls before it
will ever publish anything (`portal/engine-client/src/governed.ts`). H-04 itself is done; wiring a
live `GovernedEngine` together (idempotency store, freeze check, the actual publish endpoint) is
H-05, not yet built.

## Rules

- A draft always has a body and **at least one target account** (the social accounts it is meant
  for). Target accounts must belong to the same company as the content item - enforced by a
  composite foreign key, not just application logic.
- Every edit creates a **new version**; nothing already written is ever changed. Omitting
  `targetAccountIds` on an edit keeps the previous version's targets.
- **A new version needs a new approval** (H-04 step 6): editing an item whose status is not
  already `draft` resets it to `draft`. A still-`pending` request against the superseded version
  can still be decided later (it is kept as history), but that decision no longer moves the item's
  current status - the item has already moved on to an undecided version.
- **The creator can never review, approve or reject their own content** - the proposal's own
  process walkthrough says "reviewer cannot be the creator", not only "approver cannot be the
  creator", so `assertDifferentPeople` is enforced on all three decision endpoints, not just
  approve/reject.
- "Review" is a **comment**, a distinct step from "approve"/"reject" (which are the two symmetric
  terminal outcomes of the same gate - decided with the same `content.approve` permission).
- Another company's content item or approval request answers **404**, never 403 - loaded under
  `TenantDb` (RLS) first. A request that IS visible (e.g. a group-level role's broader RLS reach)
  but not one the caller may act on for that specific company answers 403.
- Writes are audited: `content.drafted`, `content.version_created`, `content.submitted`,
  `content.reviewed`, `content.approved`, `content.rejected`.

## The approval rule is a placeholder (H-04 step 7)

There is no category/level routing by content type yet - that is Abenezer's still-open **A-05**.
Today, **anyone holding `content.review`/`content.approve` in the right company, other than the
creator**, may decide. This is deliberately simple and designed to be replaced without touching the
tables once A-05 is formally closed (see `docs/api/MODULE-PLAN.md`).

## Permissions

`content.read`, `content.create` (draft/edit), `content.submit`, `content.review`,
`content.approve` - all already existed in `contracts/permissions.ts`; no new permission was added.
Only `content_creator` and `company_marketing_manager` hold `content.create`/`content.submit`;
`content_reviewer`, `company_executive`, `company_marketing_manager` and `group_marketing` hold
`content.review`/`content.approve` (not every role holds both, by design).

## Endpoints

| Method | Path                                 | Permission        | Notes                                                                                                                                                                                                                           |
| ------ | ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/content-items`                 | `content.read`    | Scoped to the caller's companies/group.                                                                                                                                                                                         |
| GET    | `/api/content-items/:id`             | `content.read`    |                                                                                                                                                                                                                                 |
| GET    | `/api/content-items/:id/versions`    | `content.read`    | Newest first.                                                                                                                                                                                                                   |
| GET    | `/api/content-items/:id/approval`    | `content.read`    | The approval request for the _current_ version, with its decision history, or `null` if none exists yet (e.g. still `draft`, or edited since the last request).                                                                 |
| POST   | `/api/content-items`                 | `content.create`  | Body includes `companyId` - as with the social account registry's create endpoint, there is no existing row yet to load it from, so the company is loaded under RLS and re-checked with `authz.can` before anything is written. |
| PATCH  | `/api/content-items/:id`             | `content.create`  | Creates a new version; never edits an existing one. Resets status to `draft` if it was anything else.                                                                                                                           |
| POST   | `/api/content-items/:id/submit`      | `content.submit`  | Creates one `approval_requests` row for the current version; 409 if the item is not `draft`/`rejected`, or the version already has a request.                                                                                   |
| POST   | `/api/approval-requests/:id/review`  | `content.review`  | A comment; does not change the request's status.                                                                                                                                                                                |
| POST   | `/api/approval-requests/:id/approve` | `content.approve` | 409 if the request is not `pending`.                                                                                                                                                                                            |
| POST   | `/api/approval-requests/:id/reject`  | `content.approve` | 409 if the request is not `pending`.                                                                                                                                                                                            |

## Data model

`content_items` (tracks `current_version_id` and lifecycle `status`) → `content_versions`
(immutable) → `content_version_targets`. `approval_requests` (one per version) →
`approval_decisions` (append-only: comments, then the one terminal approve/reject).

## ContentApprovalVerifier (part 3)

`portal/backend/src/modules/content/approval-verifier.ts` implements `ApprovalVerifier` from
`@dcc/engine-client`. Given a `PublishRequest` (content id, approval version number, company,
engine channel id), answers `{ok: true}` only when **all** of:

1. the content item and that exact version number exist in the request's company;
2. that version is still the item's **current** version - an older version approved before a later
   edit never verifies, even though its own `approval_requests` row still says `approved` (H-04 step
   6: a new version needs a new approval);
3. the engine channel id maps to a connected `social_accounts` row in that company, and that account
   is one of the version's approved targets;
4. the version's `approval_requests` row is `approved`.

It runs as a company-scoped **system** check, not a signed-in person - no RLS policy it touches
reads `app.user_id`, so it uses a reserved nil UUID for `TenantDb`'s required context rather than a
real user. It has no controller or HTTP surface; it is registered in `app.module.ts` so it is ready
to inject into a live `GovernedEngine` once H-05 builds one.

## Not built yet

- Wiring `ContentApprovalVerifier` into an actual `GovernedEngine` instance, plus the
  `IdempotencyStore`, `FreezeCheck` and the real publish endpoint - all H-05.
- The category/level approval routing - still Abenezer's open A-05.
- Any UI-facing "who may decide this" lookup beyond the raw permission check - not asked for yet.

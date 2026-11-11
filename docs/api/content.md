# Content: drafting and versions (H-04, part 1 of 2-3)

Owner: Hirko. Part 1 only: create a draft, edit it (every edit makes a new, immutable version),
list, read, and see the full version history. **Submit for review, review, approve, reject,
separation of duties and the `ApprovalVerifier` are not in this cut** - they land in the next
pull request(s), once the placeholder approval rule (or Abenezer's A-05) is ready.

## Rules

- A draft always has a body and **at least one target account** (the social accounts it is meant
  for). Target accounts must belong to the same company as the content item - enforced by a
  composite foreign key, not just application logic.
- Every edit creates a **new version**; nothing already written is ever changed. Omitting
  `targetAccountIds` on an edit keeps the previous version's targets.
- Another company's content item answers **404**, never 403 - loaded under `TenantDb` (RLS) first,
  so a guessed id cannot be told apart from one that does not exist.
- Writes are audited: `content.drafted` (create) and `content.version_created` (edit).

## Permissions

`content.read` (list/get/history) and `content.create` (draft/edit). Both already existed in
`contracts/permissions.ts`. Only `content_creator` and `company_marketing_manager` hold
`content.create` today - `company_admin`, `auditor` and the group-level roles do not (they can read
but not write content), which is deliberate separation, not an oversight.

## Endpoints

| Method | Path                              | Permission       | Notes                                                                                                                                                                                                                           |
| ------ | --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/content-items`              | `content.read`   | Scoped to the caller's companies/group.                                                                                                                                                                                         |
| GET    | `/api/content-items/:id`          | `content.read`   |                                                                                                                                                                                                                                 |
| GET    | `/api/content-items/:id/versions` | `content.read`   | Newest first.                                                                                                                                                                                                                   |
| POST   | `/api/content-items`              | `content.create` | Body includes `companyId` - as with the social account registry's create endpoint, there is no existing row yet to load it from, so the company is loaded under RLS and re-checked with `authz.can` before anything is written. |
| PATCH  | `/api/content-items/:id`          | `content.create` | Creates a new version; never edits an existing one.                                                                                                                                                                             |

## Data model

`content_items` (one row per piece of content, tracks `current_version_id` and lifecycle
`status`) → `content_versions` (immutable, one row per edit, `version_number` increasing) →
`content_version_targets` (which social accounts a version is meant for). `approval_requests` and
`approval_decisions` tables already exist in the migration (designed together, per H-04 step 2) but
are unused until the next pull request.

## Not built yet

- Submit / review / approve / reject, and the separation-of-duties check (`assertDifferentPeople`).
- The `ApprovalVerifier` implementation for `portal/engine-client/src/governed.ts`.
- The category/level approval routing - still Abenezer's open A-05. The placeholder rule (one
  reviewer who is not the creator) is designed to be easy to replace once that lands.

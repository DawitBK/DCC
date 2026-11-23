# Publishing: records, idempotency, and the freeze switch (H-05)

Owner: Hirko. The real "sent before?" memory the approval door needs, plus the emergency freeze
switch (FR-15). Runs against the **fake engine only** (`ENGINE_PROVIDER=fake`) - the adapter has
never been run against a live Postiz (W-03, ASM-08), so `ENGINE_PROVIDER=postiz` is refused at
startup rather than silently wired in unverified. See
`portal/backend/src/modules/publishing/operational-engine.provider.ts`.

## Be honest about what "frozen" means

The freeze switch stops publishing **through DCC**. It does not, and cannot, stop someone from
posting directly on the network with their own native access - that is outside anything this
platform controls.

## Rules

- Publishing goes through `GovernedEngine` (`portal/engine-client/src/governed.ts`): not frozen, an
  approved version for this exact channel (`ContentApprovalVerifier`, H-04), and not already sent or
  in flight (the idempotency store). Nothing here calls the engine directly.
- The idempotency key is derived from content id + version number + the engine's channel id. A
  repeated publish call for the same version and target **never calls the engine twice** - it
  upserts the same `publications` row rather than creating a second one, whether the repeat is
  sequential (click, see the result, click again) or a genuine race (two near-simultaneous clicks:
  exactly one reaches the engine, the other is refused as already in progress).
- An account must have `engine_channel_id` set (connected by the operational engine) before it can
  be published to; publishing to an unconnected account is a 400, not a confusing downstream error.
- A publish request without an approved decision is refused before the operational engine is called;
  it does not create a publication record or use the publisher as a false approver.
- Freezing is per company (`socialAccountId` omitted) or per account, checked by a **live join** to
  `social_accounts.engine_channel_id` - not a denormalized copy - so a freeze on a specific account
  stays correct even if that account is reconnected under a different channel id later.
- Both freezing and unfreezing are audited (`publishing.frozen` / `publishing.unfrozen`), as is every
  publish outcome (`publication.published` / `publication.failed`) - a still-unresolved outcome
  (engine timeout) is not audited as either, since nothing is actually known yet.

## Permissions

`content.publish` (publish), `publishing.freeze` (freeze/unfreeze/list freezes), `content.read`
(publication history) - all already existed in `contracts/permissions.ts`; no new permission was
added. Only `company_executive`, `company_marketing_manager` and `publisher` hold `content.publish`

- by design, `content_creator` and `content_reviewer` cannot (ASM-03).

## Endpoints

| Method | Path                             | Permission          | Notes                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | -------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/content-items/:id/publish` | `content.publish`   | Body: `{socialAccountId}`. 403 if not approved or frozen; 409 if a prior attempt for the same version/target is still in progress or its outcome is unknown (reconciliation needed, never auto-retried); 400 if the account isn't connected to the engine yet.                                                                                                                                |
| GET    | `/api/publications`              | `content.read`      | Scoped to the caller's companies/group.                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/api/publications/reconcile`    | `content.publish`   | Starts with `in_progress`/`unknown` idempotency keys visible through the caller's company scope, then checks scheduled and unresolved publications. A unique match requires the same channel, normalized approved text, `creationMethod: api`, and a 15-minute window around the attempt. Ambiguous or missing matches remain blocked in `unresolvedKeys`; nothing is sent by reconciliation. |
| POST   | `/api/publications/:id/cancel`   | `content.publish`   | Cancels a scheduled publication before its time. The record remains as `cancelled`.                                                                                                                                                                                                                                                                                                           |
| GET    | `/api/publishing-freezes`        | `publishing.freeze` | Scoped to the caller's companies/group.                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/api/publishing-freezes`        | `publishing.freeze` | Body: `{companyId, socialAccountId?, reason?}`. 409 if that exact scope (whole company, or that one account) is already frozen.                                                                                                                                                                                                                                                               |
| DELETE | `/api/publishing-freezes/:id`    | `publishing.freeze` | Unfreezes.                                                                                                                                                                                                                                                                                                                                                                                    |

## Data model

`publications` - one row per distinct publish attempt (content item + version + target account),
keyed by `idempotency_key` (unique). `idempotency_keys` - the separate, internal technical store
`GovernedEngine` itself relies on; it has no company column. During reconciliation, the real key
format (`contentItemId:version:channelId`) is resolved to the content item inside `TenantDb`, so
an orphan key is visible only to users with `content.publish` for that company. A settled match
saves the engine operation ID in both the publication and key result; ambiguous or missing matches
stay blocked. `publishing_freezes` - per company or per account.

## Not built yet

- Wiring a real, verified engine (`ENGINE_PROVIDER=postiz`) - blocked on Woluman's W-03.
- A scheduled reconciliation job is not part of the pilot; reconciliation runs on request. Direct
  posts made on a social network are not monitored because the required network read APIs are not
  proven yet.

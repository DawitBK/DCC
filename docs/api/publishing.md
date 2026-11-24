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

| Method | Path                                       | Permission          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/content-items/:id/publish`           | `content.publish`   | Body: `{socialAccountId}`. 403 if not approved or frozen; 409 if a prior attempt for the same version/target is still in progress or its outcome is unknown (reconciliation needed, never auto-retried); 400 if the account isn't connected to the engine yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| GET    | `/api/publications`                        | `content.read`      | Scoped to the caller's companies/group.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| POST   | `/api/publications/reconcile`              | `content.publish`   | Starts with `in_progress`/`unknown` idempotency keys visible through the caller's company scope, then checks scheduled and unresolved publications. A unique match requires the same channel, normalized approved text, `creationMethod: api`, and a 15-minute window around the attempt (around the **scheduled time** for a publication that has one). A unique match for a key with no publication row creates the `publications` row in the same transaction (H-17). A stuck scheduled publication whose post the engine holds queued becomes `scheduled` (counted in `scheduled`). Ambiguous or missing matches remain blocked in `unresolvedKeys` (an ambiguous one lists `candidateEngineOperationIds`); nothing is sent by reconciliation.                                                                                                                                                                                                                                                                                                      |
| POST   | `/api/publications/stuck-keys/:key/settle` | `content.publish`   | Settles one stuck key by hand (H-17). `:key` is `<contentItemId>:<version>:<channelId>` (URL-encode the colons if your client does not). Body: `{outcome: "published", engineOperationId, reason}` or `{outcome: "not_published", reason}`; the reason is required (1 to 500 characters). 200 `{key, outcome, publication}` with outcome `published`, `scheduled` or `not_published`. 404 for a key that does not exist, is not stuck, or belongs to a company the caller cannot publish for (the same answer, so nothing is revealed); 400 for a bad body or an engine post id the engine does not report (in the key's time window, up to 90 days ahead); 409 for a post that is on another channel, was not created through the API (a suspected bypass: refused so settling can never launder one), is not `published` or `queued`, or already belongs to another publication; 409 for `not_published` while the engine still holds a matching sent or queued post; 409 if someone else settled the key first; 502 if the engine cannot be reached. |
| POST   | `/api/publications/reconcile-bypass`       | `incident.manage`   | Checks recent engine posts without sending or deleting anything, for the companies where the caller holds `incident.manage`. A post whose creation method is not `api`, or an `api` post with no DCC publication (unless its idempotency key is still unsettled and matches it), creates or updates ONE high-severity incident per engine post, with the engine evidence, and notifies `incident.read` holders when it is created. A repeat run with the same evidence changes and audits nothing; an incident a person resolved or closed is left alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| POST   | `/api/publications/:id/cancel`             | `content.publish`   | Cancels a scheduled publication before its time. The record remains as `cancelled`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| GET    | `/api/publishing-freezes`                  | `publishing.freeze` | Scoped to the caller's companies/group.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| POST   | `/api/publishing-freezes`                  | `publishing.freeze` | Body: `{companyId, socialAccountId?, reason?}`. 409 if that exact scope (whole company, or that one account) is already frozen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| DELETE | `/api/publishing-freezes/:id`              | `publishing.freeze` | Unfreezes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Settling a stuck key by hand (H-17)

Reconciliation settles a key only on one clear match. For the rest (`ambiguous_match`, `no_match`) a person who holds `content.publish`
for the key's company decides, with `POST /api/publications/stuck-keys/:key/settle`:

- **`published`** names the engine post that is this publication. The server reads the engine and checks that the post is on the
  key's channel, was created through the API (a post made on the Postiz screen is a bypass and is refused), is `published` or
  `queued`, and is not already another publication's. A `queued` post becomes a `scheduled` publication at the engine's time. If the
  key has no publication row (a crash), the row is created (`requested_by` is the resolver, because nothing else records who
  pressed publish; `approved_by` is the version's approver; the audit event says `recordCreatedFromKey`). The key becomes `done`.
- **`not_published`** declares nothing was sent. It is refused while the engine holds any sent or queued API post with this text on
  this channel, because releasing the key would allow a second send; name that post instead. Otherwise the publication (if any) becomes
  `failed` with the reason, and the key is released so the same version can be published again.
- Either way one audit event (`publication.published`, `publication.scheduled` or `publication.failed`) is written in the same
  transaction as the change, with `manual: true`, the resolver, the time, the reason and the engine evidence (including whether the
  stored text matched the approved text).

The key is resolved to its company through the content item only among the companies where the caller holds `content.publish`, and
that is checked again inside the writing transaction. Nothing here sends a post.

## Data model

`publications` - one row per distinct publish attempt (content item + version + target account),
keyed by `idempotency_key` (unique). `idempotency_keys` - the separate, internal technical store
`GovernedEngine` itself relies on; it has no company column. During reconciliation, the real key
format (`contentItemId:version:channelId`) is resolved to the content item inside `TenantDb`, so
an orphan key is visible only to users with `content.publish` for that company. A settled match
saves the engine operation ID in both the publication and key result; ambiguous or missing matches
stay blocked. `publishing_freezes` - per company or per account.

## Retention of idempotency keys (H-15)

The rows of `idempotency_keys` are kept (small, evidence). A maintenance command, `npm run idempotency:prune -- --older-than-days <N> [--apply]`, can remove `done` keys older than N days (N at least 30, required, no default) that no `pending` or `scheduled` publication waits on; never `in_progress` or `unknown`. Dry run unless `--apply`; an applied run writes one audit event (counts, cutoff, digest). Nothing runs it automatically. A removed `done` key no longer guards against publishing the same version to the same channel again: read [IDEMPOTENCY-RETENTION](../devops/IDEMPOTENCY-RETENTION.md) before using it.

## Not built yet

- Wiring a real, verified engine (`ENGINE_PROVIDER=postiz`) - blocked on Woluman's W-03.
- Proven only against the fake engine: how Postiz stores the text and how exactly it reports the scheduled time (W-03).
- A scheduled reconciliation job is not part of the pilot; reconciliation runs on request. Direct
  posts made on a social network are not monitored because the required network read APIs are not
  proven yet.

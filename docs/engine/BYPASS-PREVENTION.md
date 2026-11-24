# Bypass prevention and reconciliation design (W-05)

**Owner:** Woluman · **Status:** design for Dawit's review; backend implementation belongs to Hirko (H-11).

## Controls that prevent bypass

- Keep DCC as the only publisher. Only the DCC server holds the Postiz public API key; the key is never sent to browsers or users.
- Keep Postiz registration closed after the engine administrator is provisioned. Do not create end-user Postiz accounts. Restrict the admin interface to the engine administrators and the approved DCC/server network path; block user-network access at the host firewall/reverse proxy.
- Keep DCC publishing behind `GovernedEngine` (approval, freeze and idempotency checks). Do not expose another publishing route or share the Postiz key.
- Do not use Postiz features that can publish independently of DCC, including AutoPost/feed rules, manual scheduling and direct publish in the Postiz UI. Keep those features unavailable to routine operators. The engine administrator is for maintenance and channel connection only.
- Recheck registration, network restrictions, key custody, and available Postiz publishing paths after each upgrade. These controls reduce bypass opportunities; reconciliation remains necessary to detect a post that gets through.

## Reconcile posts created directly in Postiz

DCC already has **on-request reconciliation** for recorded publications with an engine operation ID, and cancellation of scheduled publications. The current reconciliation lists Postiz posts and updates DCC records by matching `engine_operation_id`; it does not discover unrecorded Postiz posts. Add a scheduled reconciliation owned by the backend (Hirko):

1. For each permitted company/channel scope, read DCC's expected publications and enumerate Postiz posts for an overlapping time window. Keep all company data access inside `TenantDb.run(...)` and apply the caller/job's company scope.
2. Compare each Postiz engine operation ID and channel ID with DCC's authorized publication rows. A Postiz post with no matching DCC authorization is a **suspected unauthorized publication**. Create one idempotent incident per engine post, retain the evidence (channel, engine ID, state, publish time and public URL), and alert the assigned DCC operators. Do not silently delete it; deletion could remove evidence or hide an external action.
3. Recheck expected `pending`/`scheduled` publications as the existing on-request flow does. Update state and audit the reconciliation result. Do not treat a missing or not-yet-final Postiz record as proof that a publish failed.
4. Make repeated scans idempotent: the same unexpected engine post must update the existing incident rather than create a stream of duplicates. Record scan time and failures so an unavailable engine is visible as a failed check, not a clean result.

The current adapter exposes Postiz's engine post ID, channel, state, publish date and release URL. The current DCC publication record also has its engine operation ID and channel relationship. Hirko should confirm the incident fields, deduplication key, job trigger/cadence and audit event before implementing H-11. The network post ID is not currently exposed in `EnginePost`; preserving it would improve evidence and later cross-checking, but changing the shared engine type needs Dawit's review.

## Posts made directly on a social network

A Postiz-only scan cannot see an action made directly in Facebook, LinkedIn, Instagram, YouTube, TikTok or X. Detection needs a separate network-level read path for each network: enumerate recent posts from the connected page/account using the official API, then match the network post ID to a DCC-authorized publication. If a network post has no DCC match, create the same kind of suspected-bypass incident and retain its network ID, account, timestamp and URL.

This is **not available in the current adapter**. The stock Postiz public API returns Postiz posts, not a complete feed of all posts made on each network; network APIs have different permissions, limits and review requirements. Do not claim coverage until the relevant developer app, read permission and real test channel have proven the feed. Mark a network as “not monitored” where the API cannot provide it, and tell Dawit/Hirko which account and permission are needed. Abenezer's account inventory determines which networks/accounts to prioritize. A network webhook can accelerate detection only after its authentication/signature is validated; it does not replace periodic comparison.

## Settling stuck publish keys

`idempotency_keys` stores `in_progress`, `done` or `unknown`. `GovernedEngine` intentionally refuses a duplicate while a key is in progress or unknown. The publication service records an unknown outcome as `pending`, often with no `engine_operation_id`; therefore today's reconciliation cannot settle every such key automatically. Never clear a key solely because it is old, and never retry an ambiguous publish.

- **Stale `in_progress`:** alert/review after a chosen age threshold; first check whether the owning request is still active. If it is not, search the engine by channel and time. A unique matching post is evidence to attach its engine ID and reconcile; an ambiguous result stays blocked. A process crash can occur after Postiz accepted the request but before DCC saved the ID.
- **`unknown`:** keep the key blocked while checking Postiz and, where available, the social-network feed. If one matching post is found, record it as the outcome and mark the key `done`. If evidence proves the engine rejected the request or no post could have been accepted, mark the publication failed and release the key through an audited resolution. If the evidence is incomplete or multiple candidates match, leave it unknown and escalate; do not send again.
- Record the resolver, timestamp, evidence and reason for every manual resolution. Only a narrowly authorized operational role should perform it; the audit must be in the same transaction as the DCC state change.

The adapter currently lists state and timing but not post text or a stable request-correlation value, so a request with no saved operation ID cannot always be matched uniquely. Before automatic settlement, Woluman and Hirko need to agree on a correlation field or a safe candidate-matching method, and Dawit must review any shared engine-interface change. Keep unresolved keys blocked until that exists.

## Review and coordination

**For Hirko:** confirm the scheduled-job owner/cadence, incident type and deduplication key, company scoping, and the controlled resolution path for `in_progress`/`unknown` keys (H-11).

**For Dawit:** approve the prevention controls, alerting/escalation policy, network-level monitoring scope, and any change needed to expose the network post ID or correlation data. No backend implementation should begin until this design is reviewed.

## Review of 2026-11-23 (lead)

Reviewed against the Postiz v2.25.3 source in `operational-engine/postiz-app` and the DCC code on `develop`. The design stands. Four findings, and the decisions they lead to are written as D-22 and D-25 in [OPEN-DECISIONS](../project/OPEN-DECISIONS.md) (proposed; the owner approves by merging them).

**1. A correlation field is not needed, and cannot be had.** Postiz's public API does not let a client stamp a value into a post: `tags` attach only when a tag of that name already exists in the engine (`posts.repository.ts`, `createOrUpdatePost`), and `group` is a fresh UUID unless the call is an edit. What Postiz does return for every listed post (`getPosts`) is the channel, the **stored text** (`content`), the **network's own post id** (`releaseId`), the release URL, the state, the settings and **how the post was created** (`creationMethod`: `WEB`, `API`, `CLI`, `MCP`, `AUTOPOST`, `UNKNOWN`). DCC's adapter dropped all but the channel, state, date and URL. It now maps `content`, `networkPostId` and `creationMethod` (`EnginePost`, still optional fields). So a stuck publication is matched on channel + the approved version's text + a time window; two candidates means it stays blocked and goes to a person. The text may come back as HTML: compare after removing markup and white space, and expect to confirm the exact format on the first real post (W-03).

**2. Bypass detection gets a certain signal.** DCC publishes through the public API, which records `creationMethod: API`. A post made on the Postiz screen is `WEB`, through its agent tools `MCP`, through an auto-post rule `AUTOPOST`. Any listed post that is not `api` was not sent by DCC, whatever its text: that is a suspected unauthorised publication without needing a match. An `api` post with no DCC publication is also suspected (someone holds the key). This also answers the open question about the network post id in `EnginePost`.

**3. The two gaps in H-11, confirmed in the code.** A publish that times out is saved as `pending` with `engine_operation_id` null (`publications.service.ts`, `publish`), and `reconcile` reads only rows where it is not null, so those rows are never settled. A crash between the engine accepting a post and DCC saving the row leaves the key `in_progress` and **no publication row at all**; the only trace is the key. Settling therefore starts from `idempotency_keys`, not from `publications`.

**4. Scheduling and monitoring in the pilot.** The check runs on request (the reconcile button), as the handover already decides: DCC has no job runner and may not get one without the owner's approval. Posts made directly on a network are **not monitored** and the security overview says so; that changes only when a developer app, read permission and a real channel prove a network's feed.

Everything else in this design is accepted as written. What remains for Woluman: confirm the stored text format and `creationMethod: API` on the first real post, and keep the Postiz upgrade check (registration, network restriction, key custody, publishing paths) in `operational-engine/UPGRADES.md`.

## Follow-ups built (H-17)

- A stuck key with **no publication row** that matches one published post now gets its `publications` row in the same transaction as the settlement, so the post has a DCC record and the bypass check does not flag it (`requested_by` is the person who ran the reconcile, since a crash loses who pressed publish; the audit says so).
- A stuck **scheduled** publication is matched on its scheduled time (not the attempt time) by both the reconcile and the bypass check, and a queued post found that way is recorded as `scheduled`.
- A person with `content.publish` for the company settles an ambiguous or unmatched key with `POST /api/publications/stuck-keys/:key/settle`: name the engine post, or declare nothing was published. A post not created through the API is refused (settling can never hide a bypass post), and a "not published" declaration is refused while the engine holds a matching post. Audited with resolver, time, reason and evidence. Contract: [publishing](../api/publishing.md).

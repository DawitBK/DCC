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

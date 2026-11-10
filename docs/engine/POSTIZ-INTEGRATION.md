# Postiz integration

Owner: Woluman (analysis, adapter, tests); Dawit approves the approach and reviews the gate.
Code: `portal/engine-client/`. Decision: [ADR-0006](../architecture/decisions/ADR-0006-postiz-separate-service.md).
Pinned version: **v2.25.3** (`operational-engine/VERSION`). Licence: AGPL-3.0, see [POSTIZ-LICENSING-AGPL](POSTIZ-LICENSING-AGPL.md).

## Status in one line

The interface, governance gate and an adapter exist and are unit-tested against a stub. **The adapter has not been run against a live Postiz.**
Everything below marked _verified from the spec_ was read from Postiz's published OpenAPI document (`public-api/openapi.json`, v1.0.0), not tried.

## What the Postiz public API offers (verified from the spec, v2.25.3 docs)

Self-hosted base: `https://{your-domain}/api/public/v1`. Auth: API key in the `Authorization` header, **no `Bearer` prefix**.

| Need                             | Endpoint                                                                                                                           | Used by adapter                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| List channels                    | `GET /integrations`                                                                                                                | yes                                     |
| Customers (groups of channels)   | `GET /groups`                                                                                                                      | no: candidate mapping for DCC companies |
| Create / schedule / draft a post | `POST /posts` (`type`: `draft` \| `schedule` \| `now`; `posts[].integration.id`, `value[].content`, per-network `settings.__type`) | yes (text only)                         |
| List posts in a window           | `GET /posts?startDate&endDate&customer` → `state` `QUEUE\|PUBLISHED\|ERROR\|DRAFT`, `releaseURL`, `error`                          | yes                                     |
| Delete a post                    | `DELETE /posts/{id}` (also by group)                                                                                               | yes                                     |
| Change status                    | `PUT /posts/{id}/status` (`draft`\|`schedule`)                                                                                     | no                                      |
| Analytics                        | `GET /analytics/{integration}`, `GET /analytics/post/{postId}`                                                                     | no                                      |
| Media                            | `POST /upload`, `POST /upload-from-url`, `GET /media`                                                                              | no                                      |
| Connect a channel                | `GET /social/{integration}` (OAuth URL)                                                                                            | no (done by an engine admin in Postiz)  |
| Notifications                    | `GET /notifications`                                                                                                               | no                                      |

**Not in the public API:** inbox, comments or direct messages, an idempotency header (hence DCC's own idempotency record), a way to fetch one post
by id (list a window instead). The unified inbox (FR-13) is therefore **added by customising Postiz in our fork** (see below).

## The fork (decision D-12, D-18)

Repository: `https://github.com/DawitBK/postiz-app` (fork of `gitroomhq/postiz-app`). Rules:

- Branch from the pinned tag (`operational-engine/VERSION`), e.g. `dcc/main`. Feature branches `feat/woluman/<topic>` into `dcc/main`. Never push to upstream.
- Customisations live in their own modules and behind the existing API-key auth, exposed under the same `/public/v1` prefix, so the DCC adapter
  talks to one API.
- First work package (Woluman): read the upstream code and decide how each network's comments and messages can be fetched and answered
  (per-network permissions and review requirements differ: this is the real risk, not the code). Then: `GET /inbox`, `GET /inbox/{id}`,
  `POST /inbox/{id}/reply`, assignment stays in DCC.
- The DCC side is the engine-interface addition (`listInbox`, `replyToThread`) with a fake implementation first, so Hirko and Rahel can build
  against it before the fork is ready.
- Upgrades: rebase `dcc/main` onto the new upstream tag deliberately, run the adapter tests against a live instance, then bump `VERSION`.

**Webhooks** exist in the Postiz application (configured per channel in its UI) but Postiz requires a **public HTTPS URL** and rejects internal
addresses, and no payload signature scheme is documented. Baseline design: **poll** `GET /posts`; treat a webhook as an optional accelerator
only after signature/secret verification is added.

## Governance: how DCC stays the authority

`GovernedEngine.publish(request)` is the only path DCC uses to publish. It refuses unless:

1. publishing is not frozen for the company or channel (`FreezeCheck`, FR-15);
2. the content **version** is approved for this channel (`ApprovalVerifier`, implemented by Hirko's approval module);
3. the idempotency key has not been used: a completed key returns the first result; an in-flight key is refused; a key whose outcome is **unknown** (timeout or 5xx) blocks blind retries until reconciled, because Postiz would happily publish twice.

The raw engine accepts only an `ApprovedPublishRequest`, a branded type that only the gate can create (compile-time guard).

**What the gate cannot stop:** a person with an account in the Postiz UI can post there directly. Required controls (Woluman with Dawit):
no end-user Postiz accounts (engine admins only, behind VPN/allow-list); `DISABLE_REGISTRATION` on; the API key held only by the DCC server;
Postiz not reachable from user networks; admin sign-in through the SSO if Postiz's generic OAuth supports it (to verify); and a
**reconciliation job** (task W-05/H-06) comparing Postiz's posts with DCC's authorised records and raising an incident for any post DCC did not authorise.

## Records DCC keeps per publication (Hirko's publishing table)

DCC content id, approval version, approver, Postiz operation id (`postId`), external post URL (`releaseURL`), status, timestamps, error.

## Open questions for Woluman's evaluation (each becomes a finding in `docs/engine/`)

1. Per-network `settings` required by Facebook, Instagram, LinkedIn, YouTube, TikTok, X: what must be sent, what Postiz fills in.
2. Is `GET /groups` ("customers") a good company boundary inside Postiz, so a channel belongs to one company in the engine too?
3. Rate limits, retries and failure behaviour per network; what `error` looks like in practice.
4. Media upload flow for images and video; size limits.
5. Postiz SSO for its own admin UI (the upstream stack mentions generic OAuth variables).
6. Resource needs of the full stack on the intended host (Temporal + Elasticsearch).
7. Developer-app registration and review times per network (external dependency, start early).
8. Upgrade procedure and what a version bump can break (`operational-engine/UPGRADES.md` to be written).
9. What is lost if the engine is replaced (data ownership and export).

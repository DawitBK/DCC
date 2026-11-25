# Record: a post through the real Postiz, end to end, 2026-11-25

Run by the lead's engineering assistant on the lead's PC. This is the first time DCC's approval path, the adapter and a **real Postiz** have
carried a post from "approved" to "arrived on a network". The network was the **practice network** (a pretend network, see
[PRACTICE-NETWORK](../../engine/PRACTICE-NETWORK.md)), not a real one: this proves DCC and the engine work together, not that any real network accepts the post.

## Setup

| Part            | What ran                                                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine          | Postiz v2.25.3 **built from our fork** (`DawitBK/postiz-app`, branch `feat/dawit/practice-network`, `Dockerfile.dev`), image `dcc-postiz:practice-2`, with `POSTIZ_PRACTICE_NETWORK=true`. Its database, uploads and API key were kept. |
| Pretend network | `operational-engine/practice-network/server.mjs` in the compose profile `practice`, port 4100 (10 unit tests, `npm run test:practice-network`).                                                                                         |
| Channel         | One practice channel ("Kerchanshe Practice"). **It was seeded as a row in the engine's own database, not connected through the engine's screen** (see "Not proven").                                                                    |
| DCC             | A second dev backend on port 7816 (`ENGINE_PROVIDER=postiz`, `DCC_ENGINE_ALLOW_UNVERIFIED=true`, `DCC_ENGINE_PRACTICE_NETWORK_PLATFORM=linkedin`), the dev database, practice people only (`qa.*@example.test`).                        |

## Results

**1. The adapter's own live check, with a channel and a picture** (`npm run verify:live -w @dcc/engine-client`, 6 of 6 pass):
sign-in and channel list (the practice channel is listed), post list, a wrong key refused (401), an unknown channel refused before anything is sent,
a dead engine reported as "outcome unknown", and **upload a JPEG, schedule a post a year ahead, find it, delete it**.
(The first attempt failed with HTTP 400: the engine validates a post's settings against a fixed list of provider names and `practice` was missing. Fixed in the fork, image rebuilt.)

**2. The governed path through DCC** (`node scripts/verify/practice-network-e2e.mjs`, 10 of 10 pass in the run, an 11th step was added afterwards and run once by hand):

| Step                                                                                      | Result                                                                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| DCC lists the practice channel as a governed channel ("counts as linkedin")               | pass                                                                                                 |
| The company administrator registers an account and links it to the channel                | pass                                                                                                 |
| Publish now: the creator drafts, a different person approves, the publisher publishes     | publication `published`                                                                              |
| The post is on the practice network with the approved text                                | pass (arrived within the 90-second limit)                                                            |
| Schedule (two minutes ahead): the engine holds it, nothing on the network before its time | pass                                                                                                 |
| Cancel a third scheduled post                                                             | pass                                                                                                 |
| The scheduled post arrives after its time                                                 | pass                                                                                                 |
| The cancelled post never arrived                                                          | pass                                                                                                 |
| DCC's records                                                                             | first `published`, second `scheduled` (until asked), third `cancelled`                               |
| "Check with the engine" (`POST /publications/reconcile`), run once by hand afterwards     | `checked 1, published 1, failed 0, unresolved keys none`; DCC then lists 2 published and 1 cancelled |

## The inbox, added later the same day

The fork gained a unified inbox on its public API (`GET /public/v1/inbox`, `POST /public/v1/inbox/reply`; [FORK-INBOX-API](../../engine/FORK-INBOX-API.md)), a reader for
the practice channel type, and DCC's adapter and composite engine route to it when `DCC_ENGINE_POSTIZ_INBOX=true`. Image `dcc-postiz:practice-5`.
`node scripts/verify/practice-network-e2e.mjs` now ends with five inbox steps; **the full script passed 16 of 16**:

| Step                                                                                | Result                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A fan comments under the post and sends a direct message, on the practice network   | pass                                                                     |
| DCC shows both in its inbox, read through the engine, not answered yet              | pass (comment and message found; kinds right; on the registered account) |
| Answering the comment through DCC puts the reply on the network, under that comment | pass (`fromSelf`, `parentId` = the fan comment)                          |
| Answering the direct message through DCC puts the reply in that conversation        | pass                                                                     |
| DCC then shows both as answered, with first-response times recorded                 | pass                                                                     |

What the earlier runs of the day found (all fixed, in the fork and the script):

- The first inbox run failed with a 502: a post that no longer existed on the pretend network (it had been restarted) made the reader fail the whole channel. The endpoint did what it promises (it reported the channel under `problems`, not as empty); the reader now treats a deleted post as having no comments.
- The next run published nothing: the pretend network keeps its data in memory, so after a restart the engine's channel pointed at an account it had forgotten ("no such account"). An account id is now derived from the handle, and the provider and the reader make sure the account exists before using it. The last run started from a freshly restarted pretend network and passed.
- A second run of the script registered a second account for the same channel and DCC (correctly) refused: the script now reuses the account that holds the channel.

An incident on the way, for the record: the engine image was rebuilt five times in the afternoon and the builds filled the C: drive (0 MB free), which hung Docker Desktop's engine. Nothing was lost: Docker's log said to run `wsl --shutdown`, after which every container (the engine stack, the dev database, the practice network) came back with its data (the dev database still held its 63 users; the engine kept its channel and posts). Free space came from clearing npm's download cache (6 GB) and pruning Docker's build cache.

## Not proven (do not claim otherwise)

- **A real network.** Nothing here says LinkedIn, Facebook, YouTube, TikTok or X accepts or shows the post. Their rules, limits, reviews and error answers are untested.
- **Connecting a channel through the engine's own screen.** The channel row was inserted directly into the engine database as a test fixture, because the engine administrator's password was not used. The provider's connect path (`customFields`, `authenticate`) is therefore not exercised live; only listing, scheduling, publishing, deleting and the engine's workflow are.
- **The inbox on a real network.** The fork's inbox is proven against the practice network only. The readers for Facebook, Instagram, LinkedIn, YouTube, TikTok and X have never been run against a real network, and only the Facebook reader has unit tests (network stubbed); the other five have none.
- **A post that carries a picture** through DCC's governed path (the picture upload alone passed in result 1).
- **Analytics from the engine for the practice channel** (the provider has the reads; not run).
- The test image runs the fork's `Dockerfile.dev` recipe; no production image or host was involved.

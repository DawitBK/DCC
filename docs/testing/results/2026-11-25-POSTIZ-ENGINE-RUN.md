# Record: a post through the real Postiz, end to end, 2026-11-25

Run by the lead's engineering assistant on the lead's PC. This is the first time DCC's approval path, the adapter and a **real Postiz** have
carried a post from "approved" to "arrived on a network". The network was the **practice network** (a pretend network, see
[PRACTICE-NETWORK](../../engine/PRACTICE-NETWORK.md)), not a real one: this proves DCC and the engine work together, not that any real network accepts the post.

## Setup

| Part            | What ran                                                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine          | Postiz v2.25.3 **built from our fork** (`DawitBK/postiz-app`, branch `feat/dawit/practice-network`, `Dockerfile.dev`), image `dcc-postiz:practice-2`, with `POSTIZ_PRACTICE_NETWORK=true`. Its database, uploads and API key were kept. |
| Pretend network | `operational-engine/practice-network/server.mjs` in the compose profile `practice`, port 4100 (8 unit tests, `npm run test:practice-network`).                                                                                          |
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

## Not proven (do not claim otherwise)

- **A real network.** Nothing here says LinkedIn, Facebook, YouTube, TikTok or X accepts or shows the post. Their rules, limits, reviews and error answers are untested.
- **Connecting a channel through the engine's own screen.** The channel row was inserted directly into the engine database as a test fixture, because the engine administrator's password was not used. The provider's connect path (`customFields`, `authenticate`) is therefore not exercised live; only listing, scheduling, publishing, deleting and the engine's workflow are.
- **The unified inbox through the engine** (comments and direct messages): not built in the fork yet; DCC's inbox still shows practice messages. The practice network has the endpoints for it, nothing calls them.
- **A post that carries a picture** through DCC's governed path (the picture upload alone passed in result 1).
- **Analytics from the engine for the practice channel** (the provider has the reads; not run).
- The test image runs the fork's `Dockerfile.dev` recipe; no production image or host was involved.

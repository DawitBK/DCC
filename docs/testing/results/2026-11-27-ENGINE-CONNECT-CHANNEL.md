# Record: a channel connected through the engine's own screen, 2026-11-27

Closes the item "connecting a channel through the engine's own screen" of [the 2026-11-25 engine record](2026-11-25-POSTIZ-ENGINE-RUN.md), where the practice channel was a row put into the engine database as a fixture. Development computer only; the practice network, not a real network.

## What ran

- The engine image was **rebuilt from the fork branch `feat/dawit/practice-network`** (commit `ee8588f7`; `Dockerfile.dev`, tag `dcc-postiz:practice-3`) and the engine was switched to it through `postiz.env` (`POSTIZ_IMAGE`, `POSTIZ_VERSION`, `POSTIZ_PRACTICE_NETWORK=true`) with the compose `practice` profile. Its database, uploads and API key stayed.
- The engine administrator's sign-in was set for the development engine (a bcrypt hash written into the engine database for the dev account `engine-admin@dcc.local`; the password is in the git-ignored `private/engine-admin-dev.txt`, never in the repository).
- `scripts/verify/engine-connect-channel.mjs` drove a real Chromium through Postiz's own screens: sign in, **Add Channel**, the dialog now lists **"Practice network"** next to the real networks, type a handle, **Connect**. The engine answered `201` to `POST /api/integrations/social-connect/practice`, the channel `kerchanshe-practice` is in the engine's channel list on screen and in its database (provider `practice`, enabled).

## Proof against that channel (not a fixture)

| Check                                                                                                                                                                                                                     | Result              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `scripts/verify/practice-network-e2e.mjs` (governed publish by four different people, schedule, cancel, reconcile, fan comment and direct message read through the engine, replies from DCC landing on the network)       | **16 of 16 passed** |
| `npm run verify:live -w @dcc/engine-client` (authenticate and list, list posts, wrong key refused, unknown channel refused, unreachable engine reported as "outcome unknown", schedule a post a year ahead and delete it) | **6 of 6 passed**   |

DCC's dev backend was restarted with `DCC_ENGINE_PRACTICE_NETWORK_PLATFORM=linkedin` and `DCC_ENGINE_POSTIZ_INBOX=true` (settings in the git-ignored `.env`).

## What this does not show

- Nothing about a real network: its developer-app review, limits, rules and answers. A real network needs a client id and secret pasted into `postiz.env` and the engine's own connect screen for that network ([CONNECT-REAL-ACCOUNTS](../../engine/CONNECT-REAL-ACCOUNTS.md)).
- The real networks' inbox readers have still never run against a real network.
- A post that carries a picture was not run.

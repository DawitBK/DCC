# The practice network: prove a post end to end without a developer app

**Development and tests only. Never on a real host.** Status and what is proven: see the last section.

A developer app per network (LinkedIn, Meta, YouTube, TikTok, X) takes days or weeks to get. The practice network lets the whole
publishing path run **now**, through the real engine (Postiz), the real DCC adapter and the real approval gate, against a pretend
network that shows what arrived.

## The three parts

| Part                | Where                                                                                       | What it is                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The pretend network | `operational-engine/practice-network/server.mjs`                                            | A tiny Node server (no dependencies, in memory): accounts, posts (now or scheduled), delete, comments, direct messages with replies, analytics. A web page at `http://localhost:4100/` shows every post. Tests: `npm run test:practice-network` (part of `npm test`). |
| The channel type    | the fork `DawitBK/postiz-app`, branch `feat/dawit/practice-network`: `practice.provider.ts` | A Postiz channel type "Practice network". It is registered only when `POSTIZ_PRACTICE_NETWORK=true`, and it talks to `PRACTICE_NETWORK_URL`.                                                                                                                          |
| The DCC side        | `DCC_ENGINE_PRACTICE_NETWORK_PLATFORM` in `.env`, and `practicePlatform` in `PostizEngine`  | A practice channel has no DCC platform. This setting makes it count as one platform (for example `linkedin`) so an account registered as that platform can be linked and published to. Refused in production.                                                         |

## Start it

1. Build the engine image from the fork branch (about 15 minutes, 7 GB; Docker Desktop needs 8 GB of memory), as in
   `operational-engine/CUSTOMIZATIONS.md`:
   `docker build -f Dockerfile.dev --build-arg NEXT_PUBLIC_VERSION=v2.25.3 -t dcc-postiz:practice-1 .` in the fork clone, on the
   branch `feat/dawit/practice-network`.
2. In `operational-engine/postiz.env` set `POSTIZ_IMAGE=dcc-postiz`, `POSTIZ_VERSION=practice-1`, `POSTIZ_PRACTICE_NETWORK=true`.
3. From `operational-engine/`: `docker compose -f compose.postiz.yml --env-file postiz.env --profile practice up -d`.
   The pretend network is then at `http://localhost:4100/`.
4. Connect a practice channel in the engine: sign in to the engine's web address as the engine administrator, "Add channel",
   choose **Practice network**, type any handle (for example `kerchanshe-practice`). Its channel id appears in the list
   `npm run verify:live -w @dcc/engine-client` prints.
5. In `.env` (DCC): `ENGINE_PROVIDER=postiz`, `DCC_ENGINE_ALLOW_UNVERIFIED=true`, `DCC_ENGINE_PRACTICE_NETWORK_PLATFORM=linkedin`,
   then restart the backend.

## Prove it

```
POSTIZ_VERIFY_CHANNEL_ID=<the practice channel id> node scripts/verify/practice-network-e2e.mjs
```

It walks the governed path as four different people (administrator links, creator drafts, a different person approves, the
publisher publishes), publishes now, schedules, cancels, and then checks on the pretend network that the post arrived, the
scheduled one arrived only after its time, and the cancelled one never did. Also: `POSTIZ_VERIFY_CHANNEL_ID=<id> npm run verify:live -w @dcc/engine-client`
runs the adapter's own schedule-and-delete check against the same channel.

## What this proves and what it does not

It proves: the DCC adapter, the real Postiz (its workflow, its scheduling, its media handling), and the approval gate work together
from "approved" to "post on a network", including schedule and cancel. It does **not** prove anything about a real network's
rules, limits, review process or its answers; those need a real developer app (`docs/engine/CONNECT-REAL-ACCOUNTS.md`).

## Status

See the dated record in `docs/testing/results/` (the newest `*-POSTIZ-ENGINE-RUN.md`) for what has actually been run.

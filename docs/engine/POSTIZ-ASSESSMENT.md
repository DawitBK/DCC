# Postiz assessment (W-01)

Owner: Woluman · Started: 2026-11-15 · Pinned version: **v2.25.3** (`operational-engine/VERSION`, commit `a5affe62`)

What this is: what Postiz really did when we ran it, so the team knows what it can and cannot do for DCC. Every answer says what was tried, what was
seen, and one of **works / does not work / not tested yet**. Nothing here is assumed. No keys, passwords or tokens are written in this file.

Run from `operational-engine/compose.postiz.yml` and `CUSTOMIZATIONS.md` (Dawit, 2026-11-14), repeated independently on a second computer.

## 1. Test computer

| Item          | Value                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| System        | Windows 11 Pro, WSL2 Ubuntu, Docker 29.9.3 inside Ubuntu                 |
| Memory (WSL)  | 3.7 GiB total, 2.8 GiB free before start, 1 GiB swap                     |
| Disk (WSL)    | 1007 GB, 954 GB free before start                                        |
| Node.js       | **v26.1.0** (the project pins 22 in `.nvmrc`; see finding F-4)           |
| Postiz images | already on the computer from an earlier run (download time not measured) |

## 2. Steps that worked (repeatable)

In Ubuntu, in `operational-engine/` (the DCC folder seen from Linux as `/mnt/c/...`):

1. `cp postiz.env.example postiz.env` (git-ignored).
2. Set the local addresses (finding F-1): `MAIN_URL=http://localhost:4007`, `FRONTEND_URL=http://localhost:4007`,
   `NEXT_PUBLIC_BACKEND_URL=http://localhost:4007/api`, plus `NOT_SECURED=true` and `DISABLE_REGISTRATION=false` for the first account.
3. Fill `JWT_SECRET`, `POSTIZ_DB_PASSWORD`, `TEMPORAL_DB_PASSWORD` with random values (`openssl rand -hex 32` / `-hex 24`) written straight into the file.
4. Remove Windows line endings from the file (finding F-2): `sed -i 's/\r$//' postiz.env`.
5. Start: `docker compose -f compose.postiz.yml --env-file postiz.env up -d`.
6. Wait until `docker compose ... logs postiz` shows `Backend is running on: http://localhost:3000` (about 1 to 2 minutes).
7. Open `http://localhost:4007`, sign up the one engine administrator (a made-up local email, a new password kept in a password manager).
8. Close registration: `DISABLE_REGISTRATION=true` in `postiz.env`, then step 5 again. Wait for step 6 again (until then the page answers
   `502 Bad Gateway`, which is only the restart).
9. Settings, Public API: copy the key into DCC's own `.env` only (`POSTIZ_BASE_URL=http://localhost:4007/api/public/v1`, `POSTIZ_API_KEY=...`).
10. Live check from the DCC folder, so the key is read from `.env` and never typed in a command:
    `node scripts/run-with-env.mjs .env npm run verify:live -w @dcc/engine-client`.

Stop: `docker compose -f compose.postiz.yml --env-file postiz.env down` (add `-v` only to delete the engine's data too).

## 3. What we saw

| Check                              | Result                                                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack starts                       | **works**: 6 containers `Up`, `docker compose up -d` returned in **41 s**; the app was ready 1 to 2 min later                                                              |
| Only the engine port is exposed    | **works**: only `127.0.0.1:4007` is published; databases, Redis, Temporal, Elasticsearch are internal                                                                      |
| Sign-up of the first administrator | **works**: no email confirmation asked (no email service configured); lands on "connect a channel"                                                                         |
| Closing registration               | **works**: after `DISABLE_REGISTRATION=true` and a restart, the Sign up option is gone (checked in a private window)                                                       |
| Public API without a key           | **works**: refused with HTTP 401                                                                                                                                           |
| Public API with the key            | **works**: `GET /integrations`, `/posts`, `/groups`, `/notifications` answer HTTP 200 (empty lists on a fresh install)                                                     |
| DCC live check (`verify:live`)     | **works**: 5 PASS (list channels, list posts, wrong key refused, unknown channel refused, dead engine = "outcome unknown"), 1 SKIP (a real post needs a connected network) |
| Real post, scheduled post, delete  | **not tested yet**: needs a connected network account, which needs a developer app (W-04)                                                                                  |

### Memory used

| Container        | While starting | At rest (app ready) |
| ---------------- | -------------- | ------------------- |
| Postiz app       | 749 MiB        | 1.37 GiB            |
| Elasticsearch    | 660 MiB        | 649 MiB             |
| Temporal         | 33 MiB         | 174 MiB             |
| Temporal's DB    | 64 MiB         | 112 MiB             |
| Postiz DB        | 48 MiB         | 38 MiB              |
| Redis            | 9 MiB          | 9 MiB               |
| **Engine total** | about 1.56 GiB | **about 2.35 GiB**  |

At rest the engine used about 64% of the 3.7 GiB available to WSL. It ran, but with little headroom, and with no channels and no posts yet.
Input for W-07 (host sizing); the decision is Dawit's.

## 4. Findings

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Suggested action                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | `postiz.env.example` holds the future server's addresses (`https://postiz.internal.example`). Copied as it is for a local run, Postiz points at a host that does not exist. `CUSTOMIZATIONS.md` step 1 does not mention changing them.                                                                                                                                                                                                                                                                                  | Add the three local addresses to `CUSTOMIZATIONS.md` step 1.                                                                           |
| F-2 | On Windows, Git checks `postiz.env.example` out with Windows line endings, so the copied `postiz.env` had them on all 26 lines. Read from Linux, a hidden character can end up inside values (addresses, passwords).                                                                                                                                                                                                                                                                                                    | Add `sed -i 's/\r$//' postiz.env` to the steps, or have `.gitattributes` keep `*.env.example` with Linux line endings (Dawit decides). |
| F-3 | Right after a restart the page answers `502 Bad Gateway` for 1 to 2 minutes. It is the app still starting, not a fault.                                                                                                                                                                                                                                                                                                                                                                                                 | Mention it in `CUSTOMIZATIONS.md`.                                                                                                     |
| F-4 | The live check passes, then **Node.js crashes while exiting on Windows** (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c`), so the command ends with an error code although every check passed. Repeated on every run with Node v26.1.0. Cause: `process.exit()` ends the process while the "dead engine" check's connection is still closing. Proof: with `process.exit` replaced by setting `process.exitCode` (test file outside the project), 5 PASS, 1 SKIP, exit code 0, no crash. | One-line fix in `portal/engine-client/scripts/verify-postiz-live.ts` (separate pull request). Team to use Node 22 as pinned.           |
| F-5 | **LinkedIn API versions in v2.25.3** (`libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts` and `linkedin.page.provider.ts`): almost every call sends `LinkedIn-Version: 202601`, so the **sunset of 202511 on 2026-11-16 does not affect posting**. One call, **commenting on a post** (`linkedin.provider.ts` line 801), still sends **`202306`**, which is very likely no longer served by LinkedIn.                                                                                             | Not tested (no LinkedIn app yet). If confirmed, update it in the fork; it matters for LinkedIn replies in the inbox (W-08).            |
| F-6 | Sign-up needs no email confirmation on this setup. Harmless with registration closed, but registration must be closed again right after the first account, every time a new installation is made.                                                                                                                                                                                                                                                                                                                       | Keep step 8 in the installation steps (W-09).                                                                                          |

## 5. The open questions (from `POSTIZ-INTEGRATION.md`)

| #   | Question                                                  | Answer so far                                                                                                                                                                                                                                     | State          |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | Per-network `settings` Postiz needs when posting          | No channel connected yet, so nothing could be posted.                                                                                                                                                                                             | not tested yet |
| 2   | Is `GET /groups` ("customers") a usable company boundary? | The endpoint exists and answers (HTTP 200, empty list). Whether channels can be put in groups and posts kept apart by group is not tried.                                                                                                         | not tested yet |
| 3   | Rate limits, retries, what `error` looks like             | Needs real posts. Each network's published limits are in `docs/integrations/<network>.md`.                                                                                                                                                        | not tested yet |
| 4   | Media upload, size limits                                 | Not tried. The compose file stores uploads on local disk (`STORAGE_PROVIDER=local`). Instagram and TikTok fetch media from a **public** address, and our Postiz is not public: to be checked (see `docs/integrations/instagram.md`, `tiktok.md`). | not tested yet |
| 5   | SSO for Postiz's own admin screen                         | Not tried (W-07).                                                                                                                                                                                                                                 | not tested yet |
| 6   | Resource needs of the full stack                          | Measured on a developer computer: about 2.35 GiB at rest, empty (section 3). Under real load: not measured.                                                                                                                                       | partly         |
| 7   | Developer-app registration and review times               | Requirements per network written in `docs/integrations/` (W-04). No application submitted yet.                                                                                                                                                    | not tested yet |
| 8   | Upgrade procedure and what a version bump can break       | Not tried. `operational-engine/UPGRADES.md` is still to be written (W-09).                                                                                                                                                                        | not tested yet |
| 9   | What is lost if the engine is replaced                    | Not looked at yet.                                                                                                                                                                                                                                | not tested yet |

## 6. Next

1. Connect one **test** account (never a company account) as soon as any network approves the developer app, then run the live check with
   `POSTIZ_VERIFY_CHANNEL_ID` to prove a real scheduled post and its deletion (W-03). Answer questions 1 and 3 from that run.
2. Pull request for finding F-4.
3. Questions 2, 4 and 9 can be studied without a network: try groups in the Postiz screens; read how the fork serves uploaded media; list what
   Postiz stores that DCC does not.

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

| #   | Question                                                  | Answer so far                                                                                                                                                                                                                                                                                          | State                        |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| 1   | Per-network `settings` Postiz needs when posting          | No channel connected yet, so nothing could be posted.                                                                                                                                                                                                                                                  | not tested yet               |
| 2   | Is `GET /groups` ("customers") a usable company boundary? | The endpoint exists and answers (HTTP 200, empty list). Whether channels can be put in groups and posts kept apart by group is not tried.                                                                                                                                                              | not tested yet               |
| 3   | Rate limits, retries, what `error` looks like             | Needs real posts. Each network's published limits are in `docs/integrations/<network>.md`.                                                                                                                                                                                                             | not tested yet               |
| 4   | Media upload, size limits                                 | Read in the fork's code (section 5.1). Facebook, Instagram and TikTok photos are **fetched by the network from an address**, so they need media on a public address; YouTube, TikTok video, LinkedIn and X receive the file from Postiz. Postiz accepts pictures up to 10 MB and MP4 video up to 1 GB. | read in code, not tested yet |
| 5   | SSO for Postiz's own admin screen                         | Not tried (W-07).                                                                                                                                                                                                                                                                                      | not tested yet               |
| 6   | Resource needs of the full stack                          | Measured on a developer computer: about 2.35 GiB at rest, empty (section 3). Under real load: not measured.                                                                                                                                                                                            | partly                       |
| 7   | Developer-app registration and review times               | Requirements per network written in `docs/integrations/` (W-04). No application submitted yet.                                                                                                                                                                                                         | not tested yet               |
| 8   | Upgrade procedure and what a version bump can break       | Not tried. `operational-engine/UPGRADES.md` is still to be written (W-09).                                                                                                                                                                                                                             | not tested yet               |
| 9   | What is lost if the engine is replaced                    | Read in the fork's database model (section 5.2). DCC keeps every approval and its own publication record; what exists only in Postiz is the network connections (by design), the network's own post id, raw error responses, media files and scheduled jobs not yet run.                               | read in code, not tested yet |

### 5.1 Question 4 in detail: how media reaches each network

Read on 2026-11-15 in the fork at `v2.25.3` (commit `a5affe62`). Paths are under `libraries/nestjs-libraries/src/` in the fork. **Nothing here has
been tried with a real post yet.**

**Where Postiz keeps media.** With `STORAGE_PROVIDER=local` (our compose file), uploads are written to `UPLOAD_DIRECTORY` (`/uploads`, a Docker
volume) under `/YYYY/MM/DD/` with a random 32-character name, and their address is built as `FRONTEND_URL + /uploads/...`
(`upload/local.storage.ts`). On our setup that address is Postiz's own, which is private by design. The only other storage Postiz supports is
`STORAGE_PROVIDER=cloudflare`: a Cloudflare R2 bucket whose files get a public address (`upload/upload.factory.ts`, `upload/r2.uploader.ts`).

**What Postiz accepts** (`upload/custom.upload.validation.ts`, `upload/local.storage.ts`): the real file type is read from the bytes, never from
the name. Pictures: JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF, **up to 10 MB**. Video: **MP4 only, up to 1 GB**. Each network has its own, often
stricter, limits (`docs/integrations/<network>.md`; for example Instagram takes only JPEG pictures).

**How each network receives the file:**

| Network       | How the media travels (fork file)                                                                                                    | Needs a public address? |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| Instagram     | Postiz sends `image_url=` / `video_url=` and Meta downloads it (`integrations/social/instagram.provider.ts`, line 755 on)            | **yes**                 |
| Facebook      | Photos sent as `url:`, videos as `file_url:`, and Meta downloads them (`integrations/social/facebook.provider.ts`, lines 580 to 620) | **yes**                 |
| TikTok photos | `source: 'PULL_FROM_URL'`: TikTok downloads from a domain we have verified (`integrations/social/tiktok.provider.ts`, line 832)      | **yes**, and verified   |
| TikTok video  | `source: 'FILE_UPLOAD'`: Postiz sends the file in chunks (`tiktok.provider.ts`, line 843)                                            | no                      |
| YouTube       | Postiz reads the file from its disk and uploads it (`integrations/social/youtube.provider.ts`, line 522)                             | no                      |
| LinkedIn      | Postiz reads or downloads the file, then uploads it (`integrations/social/linkedin.provider.ts`, line 544)                           | no (see open point)     |
| X             | Postiz reads or downloads the file, then uploads it (`integrations/social/x.provider.ts`, line 718 on)                               | no (see open point)     |

**Open point (LinkedIn, X and Postiz's own picture conversion).** Postiz reads a media file from its disk when the stored path does not start
with `http`, but **downloads** it when it does (`integrations/social.abstract.ts`, `readOrFetch`, line 278). Those downloads go through a
safety filter that refuses private network addresses (`dtos/webhooks/ssrf.safe.dispatcher.ts`), unless `DISABLE_SSRF_PROTECTION=true`. Whether
our locally stored media reaches the providers as a disk path or as an `http` address could not be settled by reading
(`database/prisma/posts/posts.service.ts`, line 535 on, rewrites both forms). **One real post with a picture to a test account will answer it.**

**What it means for DCC (decision D7, Dawit):**

1. With our closed setup, **Facebook, Instagram and TikTok photos cannot work** as they are: the network has nowhere public to download from.
2. Options, each to be decided by Dawit because each makes media public in some way:
   - `STORAGE_PROVIDER=cloudflare`: built into Postiz, no code change; adds an outside cloud service (Cloudflare R2) and its account.
   - Make only Postiz's `/uploads` path reachable from the internet (behind Apache, HTTPS), keeping the rest of Postiz closed. No new service;
     file names are random but the files are public to anyone who has the address.
   - Change the fork so these providers upload the file instead of passing an address, where the network allows it (Meta documents
     resumable upload of **video** files for Instagram with Facebook Login; pictures still need an address). Most code to carry forward on every
     Postiz upgrade, and it does not solve pictures.
3. YouTube, TikTok video, and probably LinkedIn and X can post media from the closed setup.
4. Media in DCC itself (task W-06) is still not built: DCC sends text only, so none of this is reachable from DCC yet.

### 5.2 Question 9 in detail: what exists only inside Postiz

Read on 2026-11-15: the fork's database model (`libraries/nestjs-libraries/src/database/prisma/schema.prisma`, v2.25.3) compared with DCC's
own tables (`portal/backend/migrations/`). Nothing here has been tried (no export or replacement was attempted).

| What Postiz keeps                                                                                                     | Postiz table (fork)                                                                                         | Does DCC have it?                                                                                                                                                                           | If Postiz were replaced                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connected accounts: network, name, picture, **access and refresh tokens**, expiry, disabled                           | `Integration`                                                                                               | Only the link: `social_accounts.engine_channel_id`. DCC never holds network tokens (by design).                                                                                             | Every account is reconnected through each network's own sign-in in the new engine, and every DCC account is re-linked. Work, not data loss.               |
| Posts: text, date, state, **network post id** (`releaseId`), post address (`releaseURL`), per-network settings, error | `Post`                                                                                                      | Yes for what matters to governance: approved content and versions, approver, `engine_operation_id`, `external_post_url`, status, error (`publications`). **Not** the network's own post id. | Approvals and publication records survive. The network post id is lost: it is what later reading of comments, analytics or a delete on the network needs. |
| Failed attempts with the network's raw answer                                                                         | `Errors`                                                                                                    | Only one error text per publication.                                                                                                                                                        | The raw answers are lost (useful for support, not for governance).                                                                                        |
| Uploaded media files and their records                                                                                | `Media` + the `postiz-uploads` volume                                                                       | No (media in DCC is task W-06).                                                                                                                                                             | **All media is lost** unless the volume is backed up.                                                                                                     |
| Scheduled posts not yet published                                                                                     | `Post` (state `QUEUE`) + Temporal's database                                                                | Yes: status `scheduled`, time and content in `publications`.                                                                                                                                | They would not run. DCC knows them, so they can be sent again through the new engine.                                                                     |
| Analytics                                                                                                             | not stored: fetched live from each network, cached briefly in Redis (`integration.service.ts`, line 495 on) | No (analytics are not built in DCC).                                                                                                                                                        | Nothing lost: the networks keep the numbers.                                                                                                              |
| Groups of channels ("customers")                                                                                      | `Customer`                                                                                                  | DCC's companies are the authority.                                                                                                                                                          | Nothing lost.                                                                                                                                             |
| Engine administrators, their organisation, the public API key                                                         | `User`, `Organization`                                                                                      | No, and not needed.                                                                                                                                                                         | Recreated; DCC gets the new key.                                                                                                                          |
| Postiz's own team features: internal comments on posts, tags, signatures, saved sets, webhooks, notifications         | `Comments`, `Tags`, `Signatures`, `Sets`, `Webhooks`, `Notifications`                                       | Not used: approvals and notifications live in DCC.                                                                                                                                          | Nothing DCC relies on.                                                                                                                                    |
| Features DCC does not use: automatic posting from feeds, marketplace, AI agent tables                                 | `AutoPost`, `Orders`, `Messages`, `mastra_*`                                                                | Not used.                                                                                                                                                                                   | Nothing DCC relies on.                                                                                                                                    |

**What it means:**

1. **DCC stays the authority.** Every approval, approver, approved version and publication record is in DCC's own database. Replacing Postiz
   loses no governance record.
2. **The network's own post id should be kept in DCC.** Postiz stores it (`Post.releaseId`) but DCC's `publications` table does not. Reconciliation
   (W-05), the inbox (W-08) and analytics (W-06) all need it to find a post on the network. Suggestion for Hirko (his table): add it, and for
   the adapter (mine): return it from `listPosts`.
3. **Media must be backed up with Postiz** (the `postiz-uploads` volume) until DCC keeps its own copy (W-06, W-09).
4. **Postiz's database is sensitive.** In the code read, network access and refresh tokens are passed to the database unchanged
   (`integrations/integration.repository.ts`, line 327 on); no encryption step was found for these networks (only some self-hosted networks
   encrypt their instance details). Backups of Postiz's database must be protected like secrets (W-09). Not tested: to confirm by looking at
   the database once a test account is connected.
5. **`AutoPost` can publish without DCC.** Postiz can post automatically from a feed address. Engine administrators must never use it; the
   bypass design (W-05) should list it, and reconciliation would catch such posts.

## 6. Next

1. Connect one **test** account (never a company account) as soon as any network approves the developer app, then run the live check with
   `POSTIZ_VERIFY_CHANNEL_ID` to prove a real scheduled post and its deletion (W-03). Answer questions 1 and 3 from that run, and post one
   picture to settle the open point in section 5.1.
2. Pull request for finding F-4 (opened as `fix/woluman/verify-live-exit`).
3. Questions 2, 5 and 8 can be studied without a network: try groups in the Postiz screens; read how the fork could use our SSO for its
   admin screen; try an upgrade in the fork.
4. Raise with Hirko and Dawit: keeping the network's post id in DCC (section 5.2, point 2).

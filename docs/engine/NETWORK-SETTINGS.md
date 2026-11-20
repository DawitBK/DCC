# Network settings still to be filled in

Owner: Woluman · Written: 2026-11-18 · Directions from Dawit on issues #36 to #43

Dawit's rule: **if a value is not decided yet, do not wait.** Build so the value is a setting, and fill it in when it arrives.
This page lists every such value for the engine, where it goes, and who brings it. **No real value is ever written here or in Git.**
Real values go only in `operational-engine/postiz.env` on the engine computer (never committed) or in the network's own developer console.

## Phases (Dawit, #36 and #41)

| Network   | Phase | URL-confirmed entries in current workbook (2026-11-18) |
| --------- | ----- | ------------------------------------------------------ |
| Facebook  | first | 11                                                     |
| LinkedIn  | first | 7                                                      |
| Instagram | first | 9                                                      |
| YouTube   | first | 2                                                      |
| TikTok    | later | 2                                                      |
| X         | later | 2                                                      |

The inventory itself is private (Abenezer's data-collection workbook) and **never goes in this repository**. These are aggregate counts of platform URLs matched in the workbook, not verified totals of active accounts; no names, handles or URLs are copied here. The earlier note listed 11 LinkedIn accounts, while the current workbook has 7 URL-confirmed LinkedIn entries. Reconcile that difference privately with Abenezer before quoting a final Page count or estimating polling load. An entry without a recognized URL is not proof that the account does not exist.
They matter for limits: for example LinkedIn's Development tier allows 100 calls per member per day, Google's unverified External mode 100 users in total.

## The settings

| Setting                                                                                                            | Where it goes                                                                  | Decided?                                              | Who brings it                                     | Issue    |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------- | -------- |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`                                                                           | `postiz.env` (already read by `compose.postiz.yml`)                            | test app: Woluman; real app: no                       | Woluman (test), Dawit                             | #38      |
| Meta business portfolio and its admin                                                                              | Meta Business Suite (not a file)                                               | no                                                    | Abenezer asks, Dawit                              | #38      |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`                                                                     | `postiz.env`                                                                   | no: new app, not submitted yet                        | Dawit                                             | #37      |
| LinkedIn company details (legal name, registered address, website, privacy page, business email, Page super admin) | the LinkedIn application form, see `docs/integrations/linkedin-application.md` | no                                                    | Abenezer collects                                 | #37      |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`                                                                       | `postiz.env` (already read by `compose.postiz.yml`)                            | no                                                    | owner of the Google project                       | #39      |
| YouTube consent-screen mode: **Internal** (if the Group uses Google Workspace) or **External, in production**      | Google Cloud console, OAuth consent screen                                     | deferred; keep the choice open and do not block setup | Abenezer finds out; configure at app registration | #39      |
| Google account that owns the Google Cloud project                                                                  | Google Cloud console                                                           | no                                                    | Abenezer finds out                                | #39      |
| Public address of media files                                                                                      | `FRONTEND_URL` in `postiz.env` (see below)                                     | direction: option B, final later                      | Dawit, with the test server                       | #42      |
| `STORAGE_PROVIDER` (`local` or `cloudflare`) and `CLOUDFLARE_*`                                                    | `postiz.env` (passed through by `compose.postiz.yml`)                          | `local` until #42 is final                            | Dawit                                             | #42      |
| X, TikTok credentials                                                                                              | `postiz.env`                                                                   | later phase                                           | —                                                 | #36, #41 |

### YouTube: what the mode changes (#39)

- **Testing** mode is **not usable**: every connection expires after 7 days. Use it only for a short test on a developer computer.
- **Internal**: only for a Google Cloud project inside the Group's Google Workspace organisation; only its members can connect a channel.
- **External, in production**: works for any Google account, with an "unverified app" warning and at most 100 users until Google verifies the app
  (needs a public home page and privacy policy, the same page LinkedIn asks for).
- Nothing in Postiz changes between the modes: the same `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` are used. Keep the mode undecided while
  building; choose it in the Google Cloud console at app registration when the Workspace question is answered, then put the credentials in `postiz.env`.

### Media address: how it works today (#42)

Read in the fork (`libraries/nestjs-libraries/src/upload/local.storage.ts`, line 49): with `STORAGE_PROVIDER=local` the address Postiz gives a
network for a picture is **`FRONTEND_URL` + `/uploads/...`**. So the media address is already a setting, but it is the **same value** as Postiz's own
address. For each option of #42:

- **A (Cloudflare R2):** `STORAGE_PROVIDER=cloudflare` and its six `CLOUDFLARE_*` values in `postiz.env` (`compose.postiz.yml` passes them through
  since 2026-11-18; before, it fixed `local`). Settings only, no code change. Needs an outside Cloudflare account: Dawit decides.
- **B (only `/uploads` public behind Apache):** set `FRONTEND_URL` to the public HTTPS name, and let Apache pass only `/uploads/` to the internet.
  Settings and Apache only. Side effect: Postiz's own pages then also use that name (they stay closed, because Apache blocks every other path).
- **C (upload instead of an address):** a code change in the fork. Not planned.

If Dawit prefers the media address to be **separate** from Postiz's own address, that is a small change in the fork (a new optional setting,
defaulting to today's behaviour). Not done: ask first.

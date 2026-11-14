# TikTok: integration notes

Owner: Woluman · Task: W-04 (registration), W-08 (inbox study) · Last updated: 2026-11-14

Source: TikTok for Developers documentation, read on 2026-11-14 (links at the bottom). Official documentation is the authority.
Nothing below has been tested yet. No passwords, keys or tokens are ever written in this file.

## Status

| Step                                                              | State       | Date | Who |
| ----------------------------------------------------------------- | ----------- | ---- | --- |
| TikTok developer app "DCC (Kerchanshe Group)" registered          | not started |      |     |
| Content Posting API product added, Direct Post enabled            | not started |      |     |
| `video.publish` scope approved for the app                        | not started |      |     |
| Domain or URL prefix verified (for photo posts)                   | not started |      |     |
| **Audit** requested (to allow public posts)                       | not started |      |     |
| Test account (private, not a company account) connected in Postiz | not started |      |     |

## What this network lets us do

| Capability                                      | Offered by TikTok (docs read)                      | What Postiz supports today |
| ----------------------------------------------- | -------------------------------------------------- | -------------------------- |
| Post a video directly to the account            | yes (Direct Post)                                  | not tested yet (W-01)      |
| Send a video to the creator's TikTok as a draft | yes (Upload flow, separate guide, not read yet)    | not tested yet             |
| Post photos                                     | yes, only from a **verified domain or URL prefix** | not tested yet             |
| Read or reply to comments                       | **not in the Content Posting docs**                | n/a                        |
| Read or reply to direct messages                | **not in the Content Posting docs**                | n/a                        |

**Every TikTok post is a video or photos.** Text-only publish cannot post to TikTok; media upload (W-06) is a precondition.
**Inbox risk:** the docs read offer no comment or message API. Whether another TikTok product (for example TikTok's business APIs) offers it for our
accounts is **not checked yet**. This is the highest inbox risk of the six networks. Report to Dawit in W-08.

## What we must ask permission for

| Need              | Scope (exact name)                                |
| ----------------- | ------------------------------------------------- |
| Direct Post       | `video.publish` (the app must be approved for it) |
| Upload as a draft | in the separate Upload guide, not read yet        |

## What they require from us

1. A registered developer app with the **Content Posting API** product and **Direct Post** turned on.
2. **Audit.** Until the app passes TikTok's audit (a check of compliance with its terms):
   - everything posted through the app is **private (`SELF_ONLY`)**, visible only to the account owner;
   - **at most 5 accounts** can post through the app in 24 hours, and each must be **set to private** when posting.
     The audit form asks for **usage estimates**, which set how many creators can post per 24 hours. **An unaudited app is not usable for the Group.**
3. **Mandatory screen rules** for whoever builds the posting screen. TikTok requires: show the account's nickname from a fresh "creator info" query;
   the person must **choose privacy by hand** (no default); comment, duet and stitch switches **off by default**; a **music usage declaration** before
   the publish button; a **commercial content** disclosure (off by default, with "Your brand" / "Branded content" choices); a preview; no added
   watermarks; content sent only after explicit consent.
   **These affect DCC, not only Postiz:** in DCC the approver approves the content, but TikTok wants these choices made in the posting screen. How
   DCC's content and approval screens capture them (Rahel, Hirko) and whether the auditor accepts it is a question for Dawit.
4. Photo posts are pulled by TikTok from a **verified domain or URL prefix**, so the media must sit on a public address we own. Same problem as Instagram.

## Cost and limits

- **Cost:** no fee mentioned in the documents read.
- **Posts:** about **15 posts per day per account** through Direct Post, shared with every other app posting to that account (may vary).
- **Starting a post:** 6 requests per minute per account token.
- **Video formats:** MP4, QuickTime (MOV), WebM. Size and duration limits are in the Media Transfer Guide (not read yet). The maximum duration
  for each account comes from the creator info query and must be enforced.

## How long approval takes

- The documents read give **no timeline** for scope approval or audit. Record the real dates here.
- Audit: submitted — · answer — · result —

## Security signals the network exposes

- Not checked yet. Until checked: manual review of who can sign in to each Group account.

## Sources (read 2026-11-14)

- Content Posting API, get started (Direct Post): https://developers.tiktok.com/doc/content-posting-api-get-started
- Direct Post API reference: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- Content sharing guidelines (audit, limits, UX rules): https://developers.tiktok.com/doc/content-sharing-guidelines

# YouTube (Google): integration notes

Owner: Woluman · Task: W-04 (registration), W-08 (inbox study) · Last updated: 2026-11-14

Source: YouTube Data API v3 and Google Cloud documentation, read on 2026-11-14 (links at the bottom). Official documentation is the authority.
Nothing below has been tested yet. No passwords, keys or tokens are ever written in this file.

## Status

| Step                                                                 | State       | Date | Who |
| -------------------------------------------------------------------- | ----------- | ---- | --- |
| Google Cloud project for DCC created (owner agreed with Dawit)       | not started |      |     |
| YouTube Data API v3 enabled in the project                           | not started |      |     |
| OAuth consent screen set up (user type and status agreed with Dawit) | not started |      |     |
| Google verification of the sensitive scopes (if needed, see below)   | not started |      |     |
| Test channel (not a company channel) connected in Postiz             | not started |      |     |

## What this network lets us do

| Capability                                   | Offered by the YouTube Data API       | What Postiz supports today |
| -------------------------------------------- | ------------------------------------- | -------------------------- |
| Upload a video (title, description, privacy) | yes                                   | not tested yet (W-01)      |
| Read comments on our videos                  | yes                                   | not tested yet (W-08)      |
| Post a comment, reply to a comment           | yes                                   | not tested yet (W-08)      |
| Direct messages                              | **no** (not part of the API)          | n/a                        |
| Analytics                                    | separate YouTube Analytics API (W-06) | not tested yet             |

**Every YouTube post is a video.** DCC's text-only publish (the adapter today) cannot post to YouTube. Media upload (W-06) is a precondition.
The YouTube part of the unified inbox can only be **comments**.

## What we must ask permission for

Google OAuth scopes, granted by someone who manages the channel:

| Need                            | Scope (exact name)                                                              |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Upload videos                   | `https://www.googleapis.com/auth/youtube.upload` (or any broader YouTube scope) |
| Read and post comments, replies | `https://www.googleapis.com/auth/youtube.force-ssl`                             |

Which scopes Postiz itself requests: **not checked yet** (W-01).

## What they require from us

1. A **Google Cloud project** with the YouTube Data API v3 enabled, and an OAuth consent screen (app name, support email, privacy policy link).
2. **Pick the consent-screen setup with Dawit.** What Google says:
   - **Testing** status: at most 100 listed test users, and **every authorisation and refresh token expires after 7 days**. Postiz would lose the
     channel every week. **Not usable for real use.**
   - **Internal** user type: only for projects inside a **Google Cloud Organization**, and only that organisation's members can sign in. Usable only
     if the Group has Google Workspace and the channels are managed by Workspace accounts. Whether Internal skips Google's verification is **not
     stated** in the page read.
   - **In production** (External): Google shows an "unverified app" warning for sensitive scopes until the app is **verified**, and an unverified app
     has a **lifetime cap of 100 new users**. Google's verification needs the app's public home page and privacy policy (details to read when we apply).
3. **Good news:** the upload page now says videos uploaded from **unverified API projects are not restricted to private viewing**. Older guides say
   the opposite; the current page is the authority.

**Tell Dawit:** does the Group use Google Workspace, and who should own the Google Cloud project?

## Cost and limits

- **Cost:** free within quota. Extra quota is requested from Google (process to read when needed).
- **Quota:** 10,000 units per day for the project, shared by all calls, **plus a separate limit of 100 uploads per day** (`videos.insert`) and 100
  searches per day. Resets at **midnight Pacific Time**.
- **Costs per call:** list videos or comments 1 unit; post a comment or reply **50 units** (so at most about 200 comments and replies a day in total).
- **Uploads:** video files (`video/*`) up to **256 GB**. If no privacy is given, the video is **public**, but some channels default to private.

## How long approval takes

- No API approval is needed to start. Google verification of the consent screen, if needed: no time given in the page read. Record real dates here.
- Submitted: — · Answer: — · Result: —

## Security signals the network exposes

- Not checked yet. Until checked: manual review of who manages each Group channel.

## Sources (read 2026-11-14)

- Quota costs: https://developers.google.com/youtube/v3/determine_quota_cost
- Videos: insert: https://developers.google.com/youtube/v3/docs/videos/insert
- CommentThreads: insert: https://developers.google.com/youtube/v3/docs/commentThreads/insert
- OAuth consent (testing, internal, verification): https://support.google.com/cloud/answer/15549945

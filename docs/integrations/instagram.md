# Instagram (Meta): integration notes

Owner: Woluman · Task: W-04 (registration), W-08 (inbox study) · Last updated: 2026-11-14

Instagram uses **the same Meta developer app and business portfolio as Facebook**. The account setup, Business Verification and App Review notes are in
[facebook.md](facebook.md) and are not repeated here.

Source: Meta for Developers documentation, read on 2026-11-14 (links at the bottom). Nothing below has been tested yet.
No passwords, keys or tokens are ever written in this file.

## Status

| Step                                                                  | State       | Date | Who |
| --------------------------------------------------------------------- | ----------- | ---- | --- |
| Instagram product added to the Meta app                               | not started |      |     |
| Login type chosen (see below), agreed with Dawit                      | not started |      |     |
| Test Instagram professional account (not a company account) connected | not started |      |     |
| App Review / Advanced Access (only if needed, see facebook.md)        | not started |      |     |

## Before anything: two ways to connect, and Postiz has both

Only **professional** Instagram accounts (business or creator) can use the API. Personal accounts cannot.

| Way                                | Signs in with     | Needs a linked Facebook Page | API host              | Postiz provider name   |
| ---------------------------------- | ----------------- | ---------------------------- | --------------------- | ---------------------- |
| Instagram API with Facebook Login  | Facebook account  | **yes**                      | `graph.facebook.com`  | `instagram`            |
| Instagram API with Instagram Login | Instagram account | no                           | `graph.instagram.com` | `instagram-standalone` |

(Meta also documents a newer "Unified Login" that accepts either.) The DCC adapter already maps both Postiz names to Instagram
(`portal/engine-client/src/postiz.ts`). **Which one we use is a decision for W-01 with Dawit.** Facebook Login keeps all Group accounts under the one business portfolio
and also gives insights and hashtag search; Instagram Login avoids needing a Page per account.

## What this network lets us do

| Capability                                         | Offered by Meta | What Postiz supports today |
| -------------------------------------------------- | --------------- | -------------------------- |
| Publish single image or video                      | yes             | not tested yet (W-01)      |
| Publish reels, carousels (up to 20 items), stories | yes             | not tested yet (W-01)      |
| Read, reply to and hide comments                   | yes             | not tested yet (W-08)      |
| Read and send direct messages                      | yes             | not tested yet (W-08)      |
| Insights (analytics)                               | yes             | not tested yet (W-06)      |

**There is no text-only post on Instagram.** Every post needs an image or a video, so DCC's text-only publish (the adapter today) cannot post to Instagram.
Media upload (W-06) is a precondition for Instagram.

## What we must ask permission for

| Need                    | With Facebook Login                                           | With Instagram Login                 |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------ |
| Basic profile, media    | `instagram_basic`, `pages_show_list`, `pages_read_engagement` | `instagram_business_basic`           |
| Publish                 | `instagram_content_publish`                                   | `instagram_business_content_publish` |
| Comments (inbox)        | `instagram_manage_comments`                                   | `instagram_business_manage_comments` |
| Direct messages (inbox) | `instagram_manage_messages`                                   | `instagram_business_manage_messages` |
| Insights                | `instagram_manage_insights`                                   | not listed in the docs read          |

Advanced Access (needed for accounts whose managers have **no role** on the app or business) requires App Review **and** Business Verification.
Meta adds: an app that reviewers **cannot test** (for example behind an intranet, like our Postiz) can only be approved for `instagram_basic` and
`instagram_manage_comments`. **That would rule out publishing and messages under Advanced Access**, so the "keep everyone inside the app roles" question in
[facebook.md](facebook.md) matters even more for Instagram. To raise with Dawit.

## What they require from us

- A **professional** Instagram account for each Group brand. With Facebook Login, each must be **linked to a Facebook Page** the business portfolio manages.
- If the linked Page requires **Page Publishing Authorization**, it must be completed, or publishing is impossible.
- Media must sit on a **publicly reachable URL** when Meta fetches it (or be sent by resumable upload, Facebook Login only). How Postiz serves its media
  to Meta from a host that is not public: **to check in W-01**. This may be a real problem for our closed setup.

## Cost and limits

- **Cost:** free; no paid tier mentioned in the documents read.
- **Publishing limit:** Meta's content-publishing page says **100** API-published posts per account per 24 hours in one place and **50** in the carousel section.
  Assume **50** until tested. A carousel counts as one post. Usage is readable from the `content_publishing_limit` endpoint.
- **API calls (not messaging):** per app and account, calls per 24 hours = `4800 × number of impressions`. Throttling returns error code `80002`.
- **Messaging:** Conversations API 2 calls per second per account. Send API 100 per second (text), 10 per second (audio, video). Private replies to post
  comments: 750 per hour.
- **Formats:** images must be **JPEG**. No shopping tags or filters. Carousel images are cropped to the first image's shape (default square).

## How long approval takes

- Same Meta process as Facebook; no fixed time given. Record real dates here.
- Submitted: — · Answer: — · Result: —

## Security signals the network exposes

- Not checked yet. Until checked: manual review of who can manage each Group account (with the Facebook Page roles check).

## Sources (read 2026-11-14)

- Instagram Platform overview: https://developers.facebook.com/docs/instagram-platform/overview
- Content publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing
- Rate limiting: https://developers.facebook.com/docs/graph-api/overview/rate-limiting

# Facebook (Meta): integration notes

Owner: Woluman · Task: W-04 (registration), W-08 (inbox study) · Last updated: 2026-11-14

Facebook and Instagram are both Meta. **One Meta developer app** and **one Meta business portfolio** cover both. The Meta account setup steps are recorded here;
[instagram.md](instagram.md) covers only what is different for Instagram.

Source: Meta for Developers documentation, read on 2026-11-14 (links at the bottom). Official documentation is the authority. Nothing below has been tested yet.
No passwords, keys or tokens are ever written in this file: "stored on the server" is enough.

## Status

| Step                                               | State       | Date | Who |
| -------------------------------------------------- | ----------- | ---- | --- |
| Meta developer account created                     | not started |      |     |
| Business portfolio for Kerchanshe Group identified | not started |      |     |
| Developer app "DCC (Kerchanshe Group)" created     | not started |      |     |
| App connected to the business portfolio            | not started |      |     |
| Business Verification (only if needed, see below)  | not started |      |     |
| App Review / Advanced Access (only if needed)      | not started |      |     |
| Test Page (not a company Page) connected in Postiz | not started |      |     |

## What this network lets us do

Through the Pages API, acting as a Facebook **Page** (not a personal profile):

| Capability                               | Offered by Meta | What Postiz supports today |
| ---------------------------------------- | --------------- | -------------------------- |
| Publish text and link posts              | yes             | not tested yet (W-01)      |
| Publish photos and videos                | yes             | not tested yet (W-01)      |
| Update or delete posts the app created   | yes             | not tested yet             |
| Read comments on Page posts              | yes             | not tested yet (W-08)      |
| Reply to and delete comments as the Page | yes             | not tested yet (W-08)      |
| Read and send Messenger messages         | yes             | not tested yet (W-08)      |
| Page Insights (analytics)                | yes             | not tested yet (W-06)      |
| Webhooks for new comments and reactions  | yes             | not tested yet             |

Messenger limit: a Page may reply freely only within the **24-hour messaging window** after the person's last message (up to 7 days after some ad clicks).

## What we must ask permission for

Meta grants permissions to a person who manages the Page, through Facebook Login for Business. That person also needs the right **Page tasks**.

| Need                       | Permissions (exact names)                                                                                     | Page tasks the person needs            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Publish, update, delete    | `pages_manage_posts`, `pages_manage_engagement`, `pages_read_engagement`, `pages_read_user_engagement`        | `CREATE_CONTENT`, `MANAGE`, `MODERATE` |
| Publish video              | the above plus `publish_video`                                                                                | same                                   |
| Read and reply to comments | `pages_manage_engagement`, `pages_read_engagement`, `pages_read_user_engagement`                              | `MODERATE`, `CREATE_CONTENT`           |
| Messenger (inbox)          | `pages_messaging`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `business_management` | `MESSAGING`, `MODERATE`                |
| Analytics                  | to be confirmed in W-06 (Page Insights permission)                                                            | `ANALYZE`                              |

Meta notes that `business_management` is a dependency of `pages_messaging` and must be explained in an App Review submission.
Which of these Postiz itself requests when an engine admin connects a Page: **not checked yet** (read the fork's Facebook provider during W-01).

## What they require from us

1. A **Meta developer account** and a **developer app** of type Business.
2. A **business portfolio** (Business Manager) for the Group, with the app connected to it. Business Verification is done there by **an admin of the business**.
3. **Business Verification:** needed only if the app needs **Advanced Access**, i.e. if people **without a role** on the app (or on the business that claims it) will grant permissions.
   Meta's own page does not list the documents; it points to the Business Help Center "About Business Verification". **Tell Dawit: this needs company documents.**
4. **App Review:** every Page permission needs App Review **once the app is live for people without a role**. Meta tests the app itself; if Meta cannot reach the app to test it,
   the whole submission is rejected. Our Postiz is not reachable from outside (by design), which matters here.

### Open question for Dawit (could save weeks)

DCC only connects **the Group's own Pages**, and only **engine admins** connect them inside Postiz. Meta says that in Development Mode an app can use any permission
for people who **have a role on the app**, and that Advanced Access is needed only for people **without** one.
If every person who connects a Group Page is given a role on the app (or in the Group's business portfolio), **Standard Access may be enough, without App Review
or Business Verification.** This is a reading of the documents, **not tested**. To decide with Dawit, then prove with the test Page:

- Does a Development-Mode app keep working for months for posting to our own Pages?
- Can we give the engine admins app roles without sharing personal Facebook accounts in a way the Group does not accept?

## Cost and limits

- **Cost:** the Graph API itself is free. No paid tier is mentioned in the documents read.
- **Rate limits (Business Use Case):** with a Page token, calls per 24 hours = `4800 × number of engaged users` of the Page. Throttling returns error code `80001`
  (`32` with a user token). Live usage is visible in the App Dashboard.
- **Tokens:** Page access tokens expire. Postiz stores and refreshes them; DCC never holds them. How Postiz shows an expired connection: **not tested yet** (W-01).

## How long approval takes

- Meta's App Review and Business Verification pages give **no fixed time**. Record the real dates here when submitted.
- Submitted: — · Answer: — · Result: —

## Security signals the network exposes

- Page roles and task changes are visible in the Page settings and the business portfolio. Whether any of this is readable through the API: **not checked yet**.
- Until checked, treat it as **manual review**: a monthly check of who has a role on each Group Page (to agree with Dawit).

## Sources (read 2026-11-14)

- Pages API overview: https://developers.facebook.com/docs/pages-api/overview
- Page posts: https://developers.facebook.com/docs/pages-api/posts
- Comments and mentions: https://developers.facebook.com/docs/pages-api/comments-mentions
- Messenger Platform: https://developers.facebook.com/docs/messenger-platform/overview
- Rate limiting: https://developers.facebook.com/docs/graph-api/overview/rate-limiting
- Business Verification: https://developers.facebook.com/docs/development/release/business-verification
- App Review: https://developers.facebook.com/docs/app-review

# LinkedIn: integration notes

Owner: Woluman · Task: W-04 (registration), W-08 (inbox study) · Last updated: 2026-11-14

Source: LinkedIn developer documentation on Microsoft Learn, read on 2026-11-14 (links at the bottom). Official documentation is the authority.
Nothing below has been tested yet. No passwords, keys or tokens are ever written in this file.

## Status

| Step                                                                     | State       | Date | Who |
| ------------------------------------------------------------------------ | ----------- | ---- | --- |
| LinkedIn developer app "DCC (Kerchanshe Group)" created                  | not started |      |     |
| App verified by a **super admin** of the Group's LinkedIn Page           | not started |      |     |
| Community Management API, **Development tier** requested                 | not started |      |     |
| Community Management API, **Standard tier** requested (needs screencast) | not started |      |     |
| Test Page (not a company Page) connected in Postiz                       | not started |      |     |

## Check first (urgent): API version

LinkedIn's Marketing APIs are versioned by month, and old versions are switched off. The documentation warns that **version 202511 is sunset on
2026-11-16**. Postiz sends a LinkedIn version with its requests. **Which version Postiz v2.25.3 sends is not checked yet.** If it is 202511 or older,
LinkedIn posting from Postiz will stop working. Check this in the fork's LinkedIn provider during W-01, and tell Dawit if it is affected.

## What this network lets us do

Through the **Community Management API**, acting as a LinkedIn **Page** (organisation). Postiz has two LinkedIn providers: `linkedin` (a person's
profile) and `linkedin-page` (a company Page). **DCC needs `linkedin-page`.** The DCC adapter maps both to LinkedIn (`portal/engine-client/src/postiz.ts`).

| Capability                                | Offered by LinkedIn                              | What Postiz supports today |
| ----------------------------------------- | ------------------------------------------------ | -------------------------- |
| Post as the Page (text, images, video)    | yes                                              | not tested yet (W-01)      |
| Read comments and reactions on Page posts | yes                                              | not tested yet (W-08)      |
| Comment and reply as the Page             | yes                                              | not tested yet (W-08)      |
| Direct messages to the Page               | **not offered** in the Community Management docs | n/a                        |
| Page, follower, post and video analytics  | yes                                              | not tested yet (W-06)      |
| Webhooks for social actions               | yes, **Standard tier only**                      | not tested yet             |

So the LinkedIn part of the unified inbox can only be **comments**, not messages.

## What we must ask permission for

All are member permissions: a LinkedIn member who is an **administrator of the Page** grants them by signing in (OAuth). They come with Community
Management API access.

| Need                               | Permissions (exact names)                                           |
| ---------------------------------- | ------------------------------------------------------------------- |
| Post, comment and like as the Page | `w_organization_social`                                             |
| Read the Page's posts and comments | `r_organization_social`, `r_organization_social_feed`               |
| Manage comments and reactions      | `w_organization_social_feed`                                        |
| Manage the Page, read its reports  | `rw_organization_admin` (member must have the `ADMINISTRATOR` role) |
| Mention followers in posts         | `r_organization_followers`                                          |

Which of these Postiz itself requests: **not checked yet** (W-01).

## What they require from us

LinkedIn vets the company and the app before giving any access.

**Development tier (first request):**

1. A **registered legal organisation**, for commercial use. The Group's legal name, registered address, website and privacy policy.
2. A **business email address** that LinkedIn verifies. **Personal email addresses are refused.**
3. The app must be **verified by a super admin of the Group's LinkedIn Page**.
4. The app name and logo must not use any part of the LinkedIn or Microsoft names or logos.
5. Ask for Community Management on a **new app with no other LinkedIn API product** (otherwise the option is greyed out).
6. If refused, you cannot re-apply with the same app: you must make a new app.

**Standard tier (for real use):**

1. The integration must be finished and working in the Development tier.
2. A company and product overview, the use case, **test credentials for LinkedIn's reviewers**, and a valid privacy policy.
3. A **high-resolution, downloadable screen recording** (narration recommended) showing: an admin approving access through the full sign-in; posting
   to the Page; how a member's comment on that post is shown in our app; which personal fields of the commenter we show.

**Tell Dawit:** this needs the company's legal details, a public privacy policy page, a company email address, and the Page super admin.
LinkedIn reviewers need to **use** our app with test credentials, but our Postiz is not reachable from outside (by design). How to give reviewers access
safely is a question for Dawit.

## Cost and limits

- **Cost:** no fee is mentioned in the documents read.
- **Development tier:** 500 API calls per app and 100 per member, per 24 hours; no batch calls; webhooks off. The integration must be finished
  **within 12 months** of getting access.
- **Standard tier:** no restrictions stated. Standard limits are not published; they are shown per endpoint in the developer portal (app > Analytics).
- Limits reset at **midnight UTC**. Over the limit the API returns **HTTP 429**. Admins get an email at 75% of the app limit (1 to 2 hours late).

## How long approval takes

- The documents give **no timeline** for Development or Standard tier review. Record the real dates here.
- Development tier: submitted — · answer — · result —
- Standard tier: submitted — · answer — · result —

## Security signals the network exposes

- Page admin roles can be read through the API (organisation access APIs). Whether Postiz exposes this: not checked. Until then, manual review of
  who is an admin of each Group Page.

## Sources (read 2026-11-14)

- Community Management overview: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
- Increasing access (tiers, permissions): https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access
- Community Management app review: https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review
- Rate limits: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits

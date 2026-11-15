# X (formerly Twitter): integration notes

Owner: Woluman · Task: W-04 (registration), W-08 (inbox study) · Last updated: 2026-11-14

Source: X developer documentation (docs.x.com), read on 2026-11-14 (links at the bottom). Official documentation is the authority, and **prices
can change**: the X Developer Console is the final word. Nothing below has been tested yet. No passwords, keys or tokens are ever written in this file.

## Status

| Step                                                         | State       | Date | Who |
| ------------------------------------------------------------ | ----------- | ---- | --- |
| Developer account at console.x.com (owner agreed with Dawit) | not started |      |     |
| App "DCC (Kerchanshe Group)" created                         | not started |      |     |
| **Payment method and spending limit** set (Dawit arranges)   | not started |      |     |
| Test account (not a company account) connected in Postiz     | not started |      |     |

## What this network lets us do

| Capability                         | Offered by X                 | What Postiz supports today |
| ---------------------------------- | ---------------------------- | -------------------------- |
| Publish posts, replies and threads | yes                          | not tested yet (W-01)      |
| Upload media (images, video)       | yes                          | not tested yet (W-06)      |
| Read posts, mentions and replies   | yes (post search and lookup) | not tested yet (W-08)      |
| Hide replies to our posts          | yes                          | not tested yet             |
| Read and send direct messages      | yes                          | not tested yet (W-08)      |

## What we must ask permission for

X uses OAuth 2.0 scopes, granted by signing in to the account:

| Need                            | Scopes (exact names)                      |
| ------------------------------- | ----------------------------------------- |
| Post                            | `tweet.write`, `tweet.read`, `users.read` |
| Upload media                    | `media.write`                             |
| Read mentions and replies       | `tweet.read`, `users.read`                |
| Hide replies                    | `tweet.moderate.write`                    |
| Direct messages                 | `dm.read`, `dm.write`                     |
| Stay connected (refresh tokens) | `offline.access`                          |

Access tokens last **2 hours**. A refresh token is issued **only** with `offline.access`; without it Postiz would lose the account every 2 hours.
Which scopes Postiz requests: **not checked yet** (W-01).

## What they require from us

1. A developer account at **console.x.com** and an app. The page read mentions **no review or approval step**.
2. **Paid usage.** The X API is now **pay-per-use with credits** bought in advance in the Developer Console. No free tier is described.
   Requests are **blocked when the balance reaches zero**, so publishing to X stops silently if credits run out. Auto-recharge needs a saved card;
   spending limits are optional.

**Tell Dawit now:** X needs a **company payment card** and a monthly budget before anything can be tested.

## Cost and limits

Prices from the X pricing page, 2026-11-14 (check the Developer Console before relying on them):

| Action                           | Price per request or item |
| -------------------------------- | ------------------------- |
| Create a post                    | $0.015                    |
| Create a post **with a link**    | **$0.200**                |
| Read a post (each post returned) | $0.005                    |
| Read a DM event (each returned)  | $0.010                    |
| Send a DM                        | $0.015                    |

- The same item read twice within 24 hours is charged once.
- Pay-per-use is capped at **3 million post reads per month**; more needs an Enterprise plan.
- **Design impact:** the reconciliation job (W-05) and the inbox (W-08) both **read** X data, and every read costs money. How often they poll X
  must be set with the cost in mind. A post with a link costs over 13 times a plain post: worth telling the content teams.
- Rate limits per endpoint: not given on the pages read.

## How long approval takes

- No approval step described: access should be immediate once credits are bought. Record what really happened.
- Account created: — · Credits bought: —

## Security signals the network exposes

- Not checked yet. Until checked: manual review of who can sign in to each Group account.

## Sources (read 2026-11-14)

- About the X API: https://docs.x.com/x-api/getting-started/about-x-api
- Pricing: https://docs.x.com/x-api/getting-started/pricing
- OAuth 2.0 authorization code flow (scopes, tokens): https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code

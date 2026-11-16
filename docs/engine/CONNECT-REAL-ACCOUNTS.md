# Connecting real social accounts to the engine (for testing)

This is how a real account (a test page or a personal account) is connected to the local Postiz, so that a post approved in DCC
really appears on the network. It is for a developer computer. Nothing here is for the live server.

## Why it does not work out of the box

A social network lets a tool post for you only after two things:

1. The tool is **registered with the network as a "developer app"**. The network then gives the app two values: a client id and a client secret.
2. You press "allow" for that app on your own account (the screen Postiz opens when you click a network).

Postiz ships with no developer apps. That is why clicking LinkedIn or Google shows **"missing client_id"**: there is no app yet.
Registering an app is done on each network's own developer site, signed in as yourself. Nobody else can do it for you, and DCC cannot
skip it. For a test, an app in "development mode" is enough and needs no review by the network; only you (and people you add as testers)
can use it.

## The steps, the same for every network

1. Create the developer app on the network's site (table below). Where it asks for a **redirect / callback URL**, give exactly the one in the table.
2. Copy the two values into `operational-engine/postiz.env` (the file is git-ignored; never commit it), using the names in the table.
3. Restart the engine from `operational-engine/`:
   `docker compose -f compose.postiz.yml --env-file postiz.env up -d`
4. Open `http://localhost:4007`, sign in as the **engine administrator** (the account DCC's API key belongs to: the channels must be
   connected under that account, or DCC will not see them), click the network, press allow.
5. In DCC: **Social accounts**, open the registered account (or register it), and choose the new channel under "Engine channel".
   Real channels and practice channels are in the same list; practice ones say "(fake engine)".
6. Write a post for that account, get it approved, publish. Then check the network.

## Per network

| Network            | Where to create the app                      | Redirect URL to give                                      | Names in `postiz.env`                          | Notes for a local test                                                                                                                                                                  |
| ------------------ | -------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LinkedIn (profile) | linkedin.com/developers, "Create app"        | `http://localhost:4007/integrations/social/linkedin`      | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | The easiest one. Add the products "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" (instant). The app must be tied to a LinkedIn page; any page you manage will do. |
| LinkedIn (page)    | same app                                     | `http://localhost:4007/integrations/social/linkedin-page` | same                                           | Posting as a page needs the "Community Management API" product, which LinkedIn reviews. Start with the profile.                                                                         |
| Facebook page      | developers.facebook.com, app type "Business" | `http://localhost:4007/integrations/social/facebook`      | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`       | In development mode it works for you as the app's administrator, on pages you manage. Add "Facebook Login for Business".                                                                |
| Instagram          | same Facebook app                            | `http://localhost:4007/integrations/social/instagram`     | same                                           | The Instagram account must be a professional account linked to a Facebook page you manage.                                                                                              |
| YouTube            | console.cloud.google.com, OAuth client "Web" | `http://localhost:4007/integrations/social/youtube`       | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`   | Enable "YouTube Data API v3". Keep the consent screen in "Testing" and add your own address as a test user.                                                                             |
| X                  | developer.x.com, a project and an app        | `http://localhost:4007/integrations/social/x`             | `X_API_KEY`, `X_API_SECRET`                    | The free tier allows a small number of posts per month. Set app permissions to "Read and write".                                                                                        |
| TikTok             | developers.tiktok.com                        | must be `https://` on a public address                    | `TIKTOK_CLIENT_ID`, `TIKTOK_CLIENT_SECRET`     | **Not possible on plain localhost**: TikTok refuses `http://localhost`. It needs the engine behind a public HTTPS address (the test server, or a tunnel). Do this one last.             |

The redirect URLs above follow Postiz's pattern `<its address>/integrations/social/<network>`. If a network rejects one, open the
network in Postiz and read the `redirect_uri` in the address bar of the error page: that is the exact value it sent. The same holds
for anything else in this table that a network's site words differently: the networks change their developer sites often.

"Continue with Google" on the Postiz **sign-in** page is a different thing (signing in to Postiz itself). It is not needed: sign in
with the engine administrator's email and password.

## LinkedIn: a member profile, a Company Page, and the scope catch (found 2026-11-16)

- **The Group's real LinkedIn accounts are all Company Pages** (`linkedin.com/company/...`, from the data-collection workbook). Posting as a
  Page needs the `w_organization_social` permission, which comes with LinkedIn's **Community Management API**. LinkedIn reviews that
  access, so it can take days: ask for it early (task W-04).
- A **member profile** (a personal LinkedIn account) can be posted to with the `w_member_social` permission from the self-serve product
  "Share on LinkedIn". It is a stepping stone for a first test, not the product.
- Creating a LinkedIn app needs a Page as the app's publisher (a label, it does not decide where posts go). A Page is its own entity that
  you create and administer from your member account; it is not merged into your profile. For a test app use a small test Page.
- **The catch:** Postiz v2.25.3's personal `linkedin` channel asks for the organisation scopes too (`rw_organization_admin`,
  `w_organization_social`, `r_organization_social`, `r_basicprofile`) and checks that all of them were granted. With only the two
  self-serve products LinkedIn is expected to refuse (`unauthorized_scope_error`); this is read from the code and **not yet tried**.
  Options: request the Community Management API, or change the channel in the fork to ask for member scopes only (Woluman).

## What is proven and what is not

- Proven (2026-11-14): Postiz runs locally; DCC lists its channels; a wrong key, an unknown channel and an unreachable engine are handled.
- **Not proven:** a real post on a real network, with or without pictures. The first connected channel is the first real test.
  Run `POSTIZ_VERIFY_CHANNEL_ID=<channel id> npm run verify:live -w @dcc/engine-client` (it schedules one post a year ahead and deletes
  it), then publish one small post from DCC. Write the result in `operational-engine/CUSTOMIZATIONS.md`.
- DCC knows six networks (Facebook, Instagram, LinkedIn, YouTube, TikTok, X). A channel of another network (Bluesky, Telegram ...)
  appears in the engine's list but cannot be tied to a registered account yet.

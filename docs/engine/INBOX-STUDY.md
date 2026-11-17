# Unified inbox (W-08): study of the fork before any code

Owner: Woluman · Task: W-08 step 1 · Written: 2026-11-17 · For: Dawit (review), Hirko (DCC side)

Read in the fork `DawitBK/postiz-app`, branch `postiz-develop` (v2.25.3, commit `a5affe62`). Everything below was **read in the code**, not run.
Nothing in this study has been tested against a live network. Per-network detail is in `docs/integrations/<network>.md`.

## 1. What Postiz has today

| Question                                               | Answer from the code                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does Postiz **read** comments or messages anywhere?    | **No**, for none of our six networks. No provider has a "list comments" or "list messages" call.                                                                                                                                                                           |
| Does Postiz **write** comments?                        | **Yes.** Facebook, Instagram, LinkedIn and X have a `comment(...)` method, used to post a "first comment" or a thread under our own post (`libraries/nestjs-libraries/src/integrations/social/<network>.provider.ts`). Useful code to copy for "reply".                    |
| Does anything read engagement on a schedule?           | **Yes, the "plugs".** X and LinkedIn Page have `@Plug` methods (for example `x-autoPlugPost`) that check a post's likes every few hours and act. They run inside the post workflow on Temporal (`apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.2.ts`). |
| Does Postiz receive network webhooks for our networks? | **No.** Webhook code exists only for other networks (Discord, Reddit, Mastodon...).                                                                                                                                                                                        |
| Is there an inbox in the public API?                   | **No.** The public API (`apps/backend/src/public-api/routes/v1/public.integrations.controller.ts`) offers posts, upload, media and integrations only.                                                                                                                      |

## 2. Per network: can we build it, and what is missing

"Postiz asks for" = the permissions in the provider's `scopes` list, i.e. what an engine admin grants when connecting the account today.

| Network   | Comments                                                                                      | Direct messages                         | Postiz asks for today                                                                         | Missing to build the inbox                                                                     | Risk                                                                     |
| --------- | --------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| YouTube   | read and reply offered by the API                                                             | not offered by YouTube                  | `youtube.force-ssl` (enough for comments)                                                     | **nothing in permissions.** Only code. Quota: reply costs 50 units of 10 000/day               | **lowest**                                                               |
| Facebook  | read and reply offered                                                                        | Messenger offered, 24-hour reply window | `pages_manage_engagement`, `pages_read_engagement` (comments)                                 | `pages_read_user_engagement`; for messages `pages_messaging`, `pages_manage_metadata`          | low for comments, App Review for messages                                |
| Instagram | read and reply offered                                                                        | offered                                 | `instagram_manage_comments` (comments)                                                        | `instagram_manage_messages` (or `instagram_business_manage_messages` for the standalone login) | low for comments, App Review for messages                                |
| LinkedIn  | read and reply offered (Community Management)                                                 | **not offered** to Pages                | `r_organization_social`, `w_organization_social`, `rw_organization_admin`                     | `r_organization_social_feed`, `w_organization_social_feed`                                     | medium (Community Management access is a review with a video)            |
| X         | read replies and mentions offered                                                             | offered                                 | X uses OAuth 1.0a: the access level is set **in the X developer portal**, not in Postiz' code | app set to "Read, write and Direct message"; a paid API plan                                   | medium: **every read costs money**, polling frequency is a cost decision |
| TikTok    | **not offered** by the Content Posting API Postiz uses; another TikTok API is not checked yet | **not offered** by that API             | `video.*`, `user.info.*`                                                                      | a different TikTok product, if one exists for our accounts                                     | **highest**: possibly impossible                                         |

Adding a permission to a provider's `scopes` list is a one-line change in the fork, but every Group account must then be **reconnected** in Postiz
so the admin grants the new permission, and the network must have **approved** it for our app (W-04).

## 3. Proposed shape (for Dawit and Hirko to agree before code)

1. **Ask, do not listen.** Webhooks would need Postiz to be reachable from the internet, which our design forbids. So the fork **polls** each network on a schedule.
   It uses the scheduler Postiz already runs (Temporal): **no new server, queue or database engine.**
2. **New files in the fork, minimal edits to Postiz' own files** (rule 5 of the onboarding page):
   - `libraries/nestjs-libraries/src/integrations/inbox/` - one small "inbox reader" per network (list new comments/messages, reply), next to the existing providers, reusing their stored tokens.
   - `apps/backend/src/public-api/routes/v1/public.inbox.controller.ts` - `GET /inbox`, `GET /inbox/:id`, `POST /inbox/:id/reply`, behind the same API key as the rest of the public API.
   - The only edits to existing Postiz files: registering the new controller and the new workflow, and (per network, when approved) the extra permission in `scopes`.
3. **One network at a time, YouTube first** (no new permission needed), then Facebook and Instagram comments, then LinkedIn comments, then X, then messages.
4. **DCC side is already prepared:** `InboxEngine` (`listInbox`, `replyToMessage`) and `InboxMessage` in `portal/engine-client`. Assignment and response times stay in DCC (Hirko).

## 4. Questions for Dawit (decisions needed before code)

1. **Storage:** should the fork **store** fetched messages in a new table in Postiz' own database (a Prisma migration in the fork, more lines to carry on every upgrade),
   or **fetch live** on every `GET /inbox` (no new table, but every DCC refresh costs network quota, and money on X)? I suggest storing, with polling every N minutes.
2. **Polling interval** per network, especially X, where every read is paid. A number from you, or a monthly budget I convert into an interval.
3. **Order:** OK to start with **YouTube comments** as the first pull request into `postiz-develop`?
4. **TikTok:** accept "no inbox for TikTok" for now if TikTok offers no comment/message API for our accounts? (I will check the other TikTok APIs first.)
5. **Interface names:** `docs/engine/POSTIZ-INTEGRATION.md` says `replyToThread`, the code says `replyToMessage` (`engine.ts`). I will follow the code unless you say otherwise.
6. **Reconnecting accounts:** adding a permission means each Group account is reconnected once in Postiz by an engine admin. Who does it, and when?

## 5. Not done yet (next steps of this study)

- Check the other TikTok APIs for comments and messages (official docs only).
- Read the exact API calls per network (endpoint, fields, paging) and add them to each `docs/integrations/<network>.md`.
- Prove anything: needs a connected test account (W-04 blocks this).

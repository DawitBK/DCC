# Postiz analytics mapping (W-06)

**Owner:** Woluman · **Checked:** 20 November 2026 · **Status:** code review of pinned Postiz v2.25.3; no live network data tested.

This maps the analytics routes and provider metrics in `operational-engine/postiz-app`. It does not claim that a connected account can return them. The required developer apps, permissions, and a real test channel are still needed to prove each network.

## What Postiz exposes

The public controller in `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` exposes these routes below the configured `/api/public/v1` base path:

| Route                                | Input                                                                                        | Result and behavior                                                                                                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /analytics/:integration?date=N` | Postiz integration ID; `date` is a number of days and defaults to 7 when missing or invalid. | Account-level `AnalyticsData[]`. Postiz returns an empty array for non-social integrations or providers without account analytics.                                                                                                              |
| `GET /analytics/post/:postId?date=N` | Postiz post ID; `date` is passed to the provider where supported.                            | Post-level `AnalyticsData[]`; it can also return `{ "missing": true }` when Postiz marked the published post as missing. It returns an empty array when the post or network release ID is not available, or the provider has no post analytics. |

The provider type in `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts` is `{ label, data: [{ total, date }], percentageChange }`. Values and labels are provider-defined; Postiz does not normalize them into a cross-network metric dictionary. The account route caches successful provider results for up to an hour in production. An empty array therefore cannot distinguish “no activity” from “unsupported or unavailable.”

## Provider coverage in the pinned source

| Network        | Account-level metrics found in provider code                                                                                                             | Material limits in the current mapping                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Facebook Pages | Unique media views, total media views, post engagement, daily follows.                                                                                   | The `Page Impressions` label maps to unique media views. The implementation uses a fixed `percentageChange` value of 5, not a calculated comparison.                                 |
| Instagram      | Follower count, reach, likes, views, comments, shares, saves, and replies. Both Instagram login providers delegate to the same analytics implementation. | Several values are point-in-time totals. The implementation also supplies a fixed `percentageChange` value of 5.                                                                     |
| LinkedIn Pages | Page views; organic and paid follower gains; clicks, shares, engagement, and comments.                                                                   | The account route requests day-granularity results. The implementation supplies a fixed `percentageChange` value of 5. It uses Marketing API version `202601` in the inspected code. |
| TikTok         | Follower/following counts, total likes and videos, plus views, likes, comments, and shares across recent videos.                                         | The video aggregate is limited to the latest 20 videos and is returned as a current total, not a full time series. The date-window behavior needs live verification.                 |
| YouTube        | Daily views, estimated minutes watched, average view duration/percentage, subscribers gained/lost, and likes.                                            | The provider response does not consistently populate the `percentageChange` field declared by Postiz's shared analytics type. Post metrics are current counts.                       |
| X              | Impressions, bookmarks, likes, quotes, replies, and reposts for posts in a date window.                                                                  | The code aggregates posts into start/end points and supplies a fixed `percentageChange` value of 5. Analytics can be disabled by Postiz configuration.                               |

These are code observations, not promises about what each account's token can access. Permissions, API product approval, account type, provider errors, and network rules can reduce or change the returned metrics. Post-level analytics are implemented in the same provider files, but their metric sets and time semantics also differ.

## DCC integration gap

- `portal/engine-client/src/engine.ts` defines `OperationalEngine` without an analytics method. `EngineCapabilities` has no analytics flag. The Postiz adapter explicitly says analytics are not handled.
- `portal/backend/src/modules/reports` and `portal/contracts/src/api.ts` currently expose internal operations counts only. They do not expose audience metrics. The live analytics screen remains a placeholder.
- Adding a provider-neutral method or capability changes the shared engine interface and needs Dawit's review. The backend route, permission, company scoping and storage/retention decisions belong with Hirko. No interface or backend files were changed for this mapping.

## Decisions and proof needed before implementation

1. Dawit and Hirko agree the first-phase metric names, definitions, units, and time windows. Do not sum unlike platform metrics under one label such as “reach” or “engagement.”
2. Decide whether DCC keeps platform-native labels with a platform tag or maps only metrics with an agreed equivalent. Preserve the provider's source metric and account when storing or displaying results.
3. Define how DCC represents unsupported, unavailable, permission-denied, empty, stale, and partially returned metrics. Do not display a missing value as zero or treat a successful empty array as proof of no activity.
4. Agree company/account authorization, `report.read` behavior, refresh cadence, retention and audit needs before Hirko adds an API endpoint or storage.
5. Add adapter tests for both routes, date handling, empty/missing responses and provider errors after the interface is approved. Prove each real provider only with its required developer app, scopes and test channel. Keep analytics marked unverified until those checks pass.

## Source paths reviewed

- `operational-engine/postiz-app/apps/backend/src/public-api/routes/v1/public.integrations.controller.ts`
- `operational-engine/postiz-app/libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts`
- `operational-engine/postiz-app/libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts`
- `operational-engine/postiz-app/libraries/nestjs-libraries/src/integrations/social/`
- `portal/engine-client/src/engine.ts`, `types.ts`, and `postiz.ts`
- `portal/contracts/src/api.ts` and `portal/backend/src/modules/reports/`

# Reports: operations overview

Owner: Hirko. **This is not the analytics the proposal describes.** Followers, reach,
impressions, engagement and growth all come from the operational engine's own data, which is not
connected yet (Woluman's work, still open). What's here is a small, honest, internal operations
view over data DCC already has: how many social accounts, content items and publications exist per
company, broken down by status. Named "operations overview", never "analytics", so the two are
never confused.

## Endpoint

| Method | Path                    | Permission    | Notes                                                                                                                                                                                    |
| ------ | ----------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/reports/overview` | `report.read` | One row per company visible to the caller (scoped the same way as every other list endpoint - the caller's own companies plus every company of a group they hold a group-level role in). |

Response: `OperationsOverviewDto[]`, each with `socialAccounts` / `contentItems` / `publications` -
every one shaped `{ total, byStatus: Record<string, number> }`.

## Not built yet

- Anything the proposal would actually call analytics (engagement, reach, growth, follower counts)
  - needs the operational engine's own reporting data, not DCC's own tables.
- Incident counts in this overview - `incidents` lives on a separate, not-yet-merged branch from
  this one; add it here once that merges.
- Any time-series/trend view (this is a point-in-time snapshot of current state, not history).

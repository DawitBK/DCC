# Reports: operations overview and analytics

Owner: Hirko. The operations overview remains separate from provider analytics. Followers, reach,
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
every one shaped `{ total, byStatus: Record<string, number> }`. `incidents` has the same shape but is `null` for a company where the caller does not hold `incident.read` (`report.read` alone does not show incident numbers).

## Analytics endpoint (H-12)

| Method | Path                                                  | Permission    | Notes                                                                                                             |
| ------ | ----------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/reports/analytics?days=30`                      | `report.read` | Reads account analytics for the caller's permitted, engine-connected accounts. `days` is 1-90 and defaults to 30. |
| GET    | `/api/reports/analytics?socialAccountId=<id>&days=30` | `report.read` | Reads one permitted account. A different company's account is not returned.                                       |
| GET    | `/api/reports/analytics?publicationId=<id>&days=30`   | `report.read` | Reads post analytics for one permitted publication with an engine operation ID.                                   |

The response is `AnalyticsReportDto[]`. Each result preserves the provider's metric labels and has
status `ok`, `empty`, `missing` or `unavailable`; `empty` is not converted to zero. `unavailable` means
the engine could not answer for that one account (`reason` is a fixed sentence: "The engine refused the
request (429).", "The engine does not provide analytics for this account." or "The engine could not be
reached."); the other accounts in the response still answer, and nothing from the engine's own error text
reaches the person. The endpoint reads from the engine on request, stores nothing, and does not expose
Postiz's unreliable `percentageChange`. A publication or account of another company (or group) is "not
found", never returned. The report module receives only the two analytics reads of the engine
(`ANALYTICS_ENGINE`), never the engine itself.

## Not built yet

- Real provider figures are not proven until a real connected account and its developer-app
  permissions are tested (W-03/W-06). The fake engine is covered by backend tests.
- Any time-series/trend view (this is a point-in-time snapshot of current state, not history).

## Also built (local, not yet reviewed)

| Method | Path                         | Permission    | Notes                                                                                                                                                           |
| ------ | ---------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/reports/registry-gaps` | `report.read` | Accounts (not archived) missing an `owner`, `backup_admin` or `engine_channel`, or not `active`. Proposal objective 1: owner and backup admin on every account. |
| GET    | `/api/dashboard`             | none          | Home-screen numbers: accounts, pending approvals, published in the last 7 days, open incidents, unread notifications.                                           |

The dashboard needs no single permission: each section is limited to the companies where you hold the
permission it needs (`account.read`, `content.review`, `content.read`, `incident.read`) and is `null`,
not 0, when you hold it nowhere, so the UI can hide it. "Active" accounts stands in for the mock-up's
"secured" - there is no defined meaning of "secured" yet. Internal counts only, not analytics.

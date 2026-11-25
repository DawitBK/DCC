# API (Hirko)

The running API documents itself: start it and open `/api/docs` (Swagger, off in production unless enabled). The checked-in
snapshot is [openapi.json](openapi.json). **Edit it by hand** after changing a controller or contract. It is not purely generated: it
holds hand-written response schemas and parameter descriptions, so overwriting it from `/api/docs-json` deletes that detail (tried
2026-11-23: the file shrank and lost schemas). Use `/api/docs-json` only to compare, for example to find a path you forgot:

```powershell
(Invoke-WebRequest http://localhost:7716/api/docs-json).Content | Set-Content $env:TEMP/openapi-live.json -Encoding utf8
```

Write here: `MODULE-PLAN.md` (H-01, approved 2026-11-14), per-module notes (rules, states, who may do what), and the
contract changes agreed with Rahel. Request and response types live in `portal/contracts`.

Conventions: errors are `{statusCode, error, message, requestId}`; validation errors also carry `issues`; ids are UUIDs; permissions are `resource.action`; a record outside the caller's scope answers 404.

## Module pages

- [Companies and brands](companies.md)
- [Social accounts](social-accounts.md)
- [Access governance](access-governance.md)
- [Content and approvals](content.md)
- [Approval policy](approval-policy.md)
- [Media](media.md)
- [Publishing](publishing.md)
- [Operational engine](engine.md)
- [Unified inbox](inbox.md)
- [Incidents](incidents.md)
- [Notifications](notifications.md)
- [Dashboard](dashboard.md)
- [Reports](reports.md)
- [Security posture](security.md)
- [Audit trail](audit.md)

## Contract: "sign in again" for sensitive actions (owner: Dawit)

Six routes need a sign-in at the SSO that is at most 15 minutes old:

| Route                                | Action                   |
| ------------------------------------ | ------------------------ |
| `POST /api/memberships`              | grant a role             |
| `DELETE /api/memberships/:id`        | remove a role            |
| `DELETE /api/publishing-freezes/:id` | lift a publishing freeze |
| `GET /api/audit/export`              | export the audit trail   |
| `PUT /api/approval-policies`         | set an approval rule     |
| `DELETE /api/approval-policies/:id`  | remove an approval rule  |

With an older sign-in they answer:

```json
{
  "statusCode": 401,
  "error": "UNAUTHORIZED",
  "code": "reauth_required",
  "message": "For your security, sign in again to do this.",
  "requestId": "..."
}
```

What the web app does: read `code` **before** treating a 401 as "session ended"; send the browser to
`/api/auth/login?reauth=1&returnTo=<the current page, without the base path>`; the person signs in again and lands back on the
page; they repeat the action. `code` is exported as `REAUTH_REQUIRED_CODE` from `@dcc/contracts`. Today it is the only `code`
the API sends. A plain 401 without a `code` still means the session has ended.

To make another route sensitive: add `@RequireRecentAuth()` under its `@RequirePermission(...)`, add it to the table above,
and tell Rahel. Details: [identity and SSO](../identity-and-sso/INTEGRATION.md#re-authentication-for-sensitive-actions).

## Contract: requests the page makes by itself (owner: Dawit)

The session ends after `SESSION_IDLE_MINUTES` without activity (30 by default). A request the web app makes **on its own**, with
nobody doing anything (today: the notification bell counting unread items once a minute), must not count as activity, or a tab
left open would keep the person signed in for ever.

Such a request sends the header `X-DCC-Background: 1`. The API checks the session as always (a session already past the idle
limit is refused with a plain 401, a background request never revives it) but does **not** extend it. Every other request, which
means a person clicking, typing or opening a screen, extends it as before. The web app sets the header through
`useApiData(path, { background: true })`; use it for any new polling, and never for anything a person asked for.

Proof: `a background poll is checked but does not keep an idle session alive` in `portal/backend/test/api.e2e.test.ts`, and the
real-browser check 8 of `scripts/verify/sso-browser-checks.mjs` (a signed-in tab left open ended after the idle time).

## Changes made by the architect's review (2026-11-14)

Read these if you built against the earlier behaviour ([review](../project/reviews/2026-11-13-BACKEND-MODULES-REVIEW.md)):

- Review, approve and reject answer 403 for anyone who wrote **any** version of the item, not only its first author.
- A successful publish sets the content item's status to `published`.
- Publishing to an `archived` or `disconnected` account answers 403.
- A publish whose outcome is unknown writes the audit action `publication.outcome_unknown`.
- `GET /api/auth/login` redirects to `/?error=signin_unavailable` when the SSO cannot be reached.
- `POST /api/memberships` takes the person by `email` or by `userId` (exactly one). A new person has no role and is in no
  people list, so the "give access" form needs an email field ([access governance](access-governance.md)).

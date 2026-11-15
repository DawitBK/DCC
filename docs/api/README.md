# API (Hirko)

The running API documents itself: start it and open `/api/docs` (Swagger, off in production unless enabled). Write here: `MODULE-PLAN.md` (H-01, approved 2026-11-14), per-module notes (rules, states, who may do what), and the
contract changes agreed with Rahel. Request and response types live in `portal/contracts`.

Conventions: errors are `{statusCode, error, message, requestId}`; validation errors also carry `issues`; ids are UUIDs; permissions are `resource.action`; a record outside the caller's scope answers 404.

## Contract: "sign in again" for sensitive actions (owner: Dawit)

Four routes need a sign-in at the SSO that is at most 15 minutes old:

| Route                                | Action                   |
| ------------------------------------ | ------------------------ |
| `POST /api/memberships`              | grant a role             |
| `DELETE /api/memberships/:id`        | remove a role            |
| `DELETE /api/publishing-freezes/:id` | lift a publishing freeze |
| `GET /api/audit/export`              | export the audit trail   |

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

## Changes made by the architect's review (2026-11-14)

Read these if you built against the earlier behaviour ([review](../project/reviews/2026-11-13-BACKEND-MODULES-REVIEW.md)):

- Review, approve and reject answer 403 for anyone who wrote **any** version of the item, not only its first author.
- A successful publish sets the content item's status to `published`.
- Publishing to an `archived` or `disconnected` account answers 403.
- A publish whose outcome is unknown writes the audit action `publication.outcome_unknown`.
- `GET /api/auth/login` redirects to `/?error=signin_unavailable` when the SSO cannot be reached.
- `POST /api/memberships` takes the person by `email` or by `userId` (exactly one). A new person has no role and is in no
  people list, so the "give access" form needs an email field ([access governance](access-governance.md)).

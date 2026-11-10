# Audit trail

Owner: Dawit. Code: `portal/backend/migrations/202611101020__audit.sql`, `portal/backend/src/platform/audit/audit.service.ts`. Tests: `portal/backend/test/audit.test.ts`.

## What is recorded today

`auth.login`, `auth.login_failed` (reason code only), `auth.logout`, `auth.backchannel_logout`,
`security.access_denied`, `access.group_admin_granted_by_idp`, `access.group_admin_revoked_by_idp`,
`company.created`, `brand.created`. Each event has: time, actor (user id and IdP subject), action, target type and id,
company id, correlation (request) id, IP, a small `details` object, and the hash fields.

**To add** (owners in brackets): membership grant/revoke (Hirko, when the user-admin API is built), social account
connect/disconnect and assignment (Hirko/Woluman), content submit/approve/reject/publish/delete (Hirko), publishing
freeze on/off (Hirko), incident actions (Hirko), configuration changes (all). Rule: **any action that changes data
or access, or that a person could later ask "who did this?" about, writes an event in the same transaction.**
Keep `details` free of tokens, secrets and unnecessary personal data.

## How it is protected

- The runtime role can only SELECT audit rows (inside its tenant scope) and call `audit_append(...)` / `audit_verify()`.
- Triggers reject UPDATE, DELETE and TRUNCATE, even from the table owner, to stop accidents.
- Each row's hash covers the previous row's hash, so editing or deleting any row breaks the chain from that point;
  `GET /api/audit/verify` (needs `audit.read`) reports the first broken row. Proven in the tests, including a simulated tamper by the owner role.

## What it does not protect against (read this before telling anyone it is "tamper-proof")

A database superuser, or `dcc_owner`, can disable the trigger and rewrite every row and every hash. To make that
detectable, the chain head and rows must be copied to a place DCC administrators cannot write: a SIEM, write-once
storage, or a periodic signed checkpoint held by someone else. That is infrastructure and an open decision (D-06).
Until then the claim is **tamper-evident against partial edits, not against a privileged insider**.

## Reading

`GET /api/audit?limit=&action=&companyId=` is scoped twice: by RLS (the caller's companies) and by the `audit.read`
permission (roles that hold it: Group CTO, Security administrator, Auditor).

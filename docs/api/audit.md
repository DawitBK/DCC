# Audit trail: search and export

Owner: Hirko (read side only; writing is the platform's `AuditService`).

| Method | Path                | Permission   | Notes                                                                                                                          |
| ------ | ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/audit`        | `audit.read` | Newest first, max 200. Filters: `action`, `companyId`, `actorUserId`, `targetType`, `targetId`, `from`, `to` (ISO date-times). |
| GET    | `/api/audit/export` | `audit.read` | Same filters as a CSV download, max 5000 rows (default 1000). The export is itself audited as `audit.exported`.                |
| GET    | `/api/audit/verify` | `audit.read` | Walks the hash chain.                                                                                                          |

Scope: company-level auditors only see events of their own companies; group-level auditors also see
events with no company. `audit.exported` carries the company when the export can only cover one,
otherwise it is group-level. CSV cells starting with `=`, `+`, `-`, `@` are prefixed with `'` so a
spreadsheet does not run them as formulas.

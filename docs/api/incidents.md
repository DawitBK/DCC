# Incidents (H-06, first cut)

Owner: Hirko. "Register, escalate, track and resolve incidents" (proposal §7.1, module 10).
**This is a minimal first cut of what the proposal itself describes, not the fuller taxonomy
section 4B of the confidential team document may add** (categories, playbooks, recovery contacts,
escalation rules) - that document was not available when this was built. Easy to extend with a
later migration once it is read; nothing here should be read as a guess at its contents.

## Rules

- An incident belongs to a company and, optionally, to one social account (must belong to the same
  company - enforced by a composite foreign key).
- Severity: `low` / `medium` / `high` / `critical` (default `medium`). Status: `open` /
  `investigating` / `resolved` / `closed` (default `open`).
- Setting status to `resolved` or `closed` sets `resolvedAt`; moving back to `open` or
  `investigating` clears it.
- Another company's incident answers **404**, never 403.
- Writes are audited: `incident.opened`, `incident.updated`.

## Permissions

`incident.read`, `incident.manage` - both already existed in `contracts/permissions.ts`; no new
permission was added. Note the asymmetry: `company_admin` holds `incident.read` only (not
`incident.manage`) - `company_executive`, `group_cto` and `security_admin` are the roles that can
actually register and manage one. This is the existing permission table, not something decided here.

## Endpoints

| Method | Path                 | Permission        | Notes                                                                 |
| ------ | -------------------- | ----------------- | --------------------------------------------------------------------- |
| GET    | `/api/incidents`     | `incident.read`   | Scoped to the caller's companies/group.                               |
| GET    | `/api/incidents/:id` | `incident.read`   |                                                                       |
| POST   | `/api/incidents`     | `incident.manage` | `socialAccountId` optional; must belong to the same company if given. |
| PATCH  | `/api/incidents/:id` | `incident.manage` | Any subset of title/description/severity/status.                      |

## Not built yet

- Recovery checklists and contacts, escalation rules, and any category/playbook taxonomy - section
  4B of the team document, not available here.
- Any connection to the operational engine (e.g. auto-opening an incident from a security alert) -
  not asked for yet, and the engine integration itself is still Woluman's open work.

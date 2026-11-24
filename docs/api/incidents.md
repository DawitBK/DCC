# Incidents (H-06, first cut)

Owner: Hirko. "Register, escalate, track and resolve incidents" (proposal §7.1, module 10).
The first cut covered register, track and resolve. **Incident detail (categories, playbooks, recovery contacts) is built as STRUCTURE
only** (below): the text of section 4B of the team document is not in this repository and is not invented. Everything starts empty;
what is entered is entered by the Group. Decision D-27 (proposed) records who supplies the content.

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

## Incident detail: categories, playbooks, recovery contacts (H-06, structure only)

Migration `202611241300__incident_detail.sql`. **Nothing is shipped:** no default category, no playbook text, no contact. A new
installation has empty lists, an incident has `category: null` and `recoveryContacts: []`, and everything works that way.

**Categories.** A company has its own list, and the group has a default list offered to every company of the group
(`companyId: null`). A key is unique within its place, so a company may use the same key as the group default. A category has a name, a
status (`active` / `archived`: never deleted) and **at most one playbook**: a `title` (2 to 200 characters) and 1 to 30 `steps`, each plain
text on one line (1 to 500 characters, no line breaks or control characters). No playbook is `null`. Limits are in
`@dcc/contracts` (`MAX_PLAYBOOK_STEPS`) and again in the database.

**Recovery contacts.** Per company: `name`, `roleLabel`, `channel` (`email`, `phone` or `other`), `value` (checked against the channel: an address,
a number, or free text up to 200 characters for `other`), `position` (0 to 1000, the order shown), status `active` / `archived`. A contact
needs **no DCC account**. At most 50 active contacts per company. Names, addresses and numbers are personal data: the audit event records the
role label and the channel, never the contact itself.

**On an incident.** `POST` and `PATCH /api/incidents` accept `categoryId` (`null` on update removes it). The category must be the
incident company's own or its group's default, and `active`; anything else (another company's or group's, archived, unknown) is the same
`400`. An archived category stays on the incidents that already have it. Every incident response (list and single) now carries
`categoryId`, `category` (with its playbook as it is now, not a copy) and `recoveryContacts` (the company's **active** contacts in order).

| Method | Path                           | Permission        | Notes                                                                                                                                                                                |
| ------ | ------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/incident-categories`     | `incident.read`   | `?companyId=` optional: that company's categories plus its group's defaults (404 for a company the caller cannot see). Without it: everything in the caller's `incident.read` scope. |
| POST   | `/api/incident-categories`     | `incident.manage` | Body `{companyId?, key, name, playbook?}`. Without `companyId` it is the group default and needs `incident.manage` at **group** level (403 otherwise). 409 for a repeated key.       |
| PATCH  | `/api/incident-categories/:id` | `incident.manage` | Any of `name`, `status`, `playbook` (`null` removes it). 404 outside the caller's scope; 403 for a group default without a group-level role.                                         |
| GET    | `/api/incident-contacts`       | `incident.read`   | `?companyId=` optional, same scoping.                                                                                                                                                |
| POST   | `/api/incident-contacts`       | `incident.manage` | Body `{companyId, name, roleLabel, channel, value, position?}`. 400 past 50 active contacts.                                                                                         |
| PATCH  | `/api/incident-contacts/:id`   | `incident.manage` | Any field and `status`. A new channel or value is re-checked together. Reactivating counts against the 50.                                                                           |

Permissions are the existing `incident.read` and `incident.manage` (no new permission). Who holds them: `company_executive` (company),
`group_cto` and `security_admin` (group). `company_admin` reads only. Isolation: row-level security on both tables (a company's rows by
`app_company_allowed`; the group default is readable inside the group and written only by a group-level role; a company category's
group must be the company's group), plus `authz.can` per request. Audited: `incident_category.created`, `incident_category.updated`,
`incident_contact.created`, `incident_contact.updated`, and `incident.updated` carries `categoryFrom` / `categoryTo` when the category changes.

## Not built yet

- The actual content (categories, playbooks, who to call): it comes from section 4B of the team document (Hirko holds it), entered
  through this API. Decision D-27.
- Escalation rules and recovery checklists that tick off as steps are done: not asked for; a playbook is text.
- Any connection to the operational engine (for example auto-opening an incident from a security alert); the engine integration
  is still Woluman's open work.

# Social account registry (H-02)

Owner: Hirko. The record of every official social page: who owns it, the backup admin, who is
assigned, and its status. Tables (`social_accounts`, `account_assignments`) and row-level security
were built by the foundation (`202611101000__platform_core.sql`, `202611101010__rls_and_grants.sql`);
this module adds the write operations on top of the read-only list.

## Rules

- An account must have an owner. Set at creation (`ownerUserId`); there is no "ownerless" state.
- The backup admin, if set, must be a **different person** from the owner. Checked on create, and
  again whenever either the owner or the backup admin changes later.
- DCC never stores a social network password or token here. `engine_channel_id` (the operational
  engine's own channel id) is the only connection-related field, and it is not exposed by these
  endpoints yet (no module writes it; that lands with the engine integration).
- Status changes, assignments and backup-admin changes are all audited
  (`account.status_changed`, `account.assigned`, `account.unassigned`, `account.backup_admin_changed`,
  plus `account.created` / `account.updated`).
- Another company's account answers **404**, never 403 - the account is loaded under `TenantDb` (RLS)
  before anything else happens, so a guessed id cannot be distinguished from one that doesn't exist.

## Permissions

`account.read` (list) and `account.manage` (everything else). Both already existed in
`contracts/permissions.ts`; H-02 added no new permission.

## Endpoints

| Method | Path                                           | Permission       | Notes                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ---------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/social-accounts`                         | `account.read`   | Scoped to the caller's companies/group.                                                                                                                                                                                                                                                                                                                       |
| POST   | `/api/social-accounts`                         | `account.manage` | Body includes `companyId` - there is no existing row yet to load it from, so (unlike the other endpoints below) this is the one place a company id comes from the request body. It is still checked: the company is loaded under RLS and re-checked with `authz.can` before anything is inserted, so a company the caller cannot see 404s instead of writing. |
| PATCH  | `/api/social-accounts/:id`                     | `account.manage` | Display name, handle, public URL, brand, owner.                                                                                                                                                                                                                                                                                                               |
| PATCH  | `/api/social-accounts/:id/status`              | `account.manage` | One of `active`, `needs_attention`, `disconnected`, `archived`.                                                                                                                                                                                                                                                                                               |
| PATCH  | `/api/social-accounts/:id/backup-admin`        | `account.manage` | Rejects a backup admin equal to the current owner.                                                                                                                                                                                                                                                                                                            |
| POST   | `/api/social-accounts/:id/assignments`         | `account.manage` | Assigns a person to the account. 409 if already assigned.                                                                                                                                                                                                                                                                                                     |
| DELETE | `/api/social-accounts/:id/assignments/:userId` | `account.manage` | Unassigns. 404 if not assigned.                                                                                                                                                                                                                                                                                                                               |

## Not built yet

- A numeric "health score" (mentioned in the proposal's module description) - depends on signals
  (MFA status, token/connection health) that live in the Security center module and the operational
  engine; not meaningful to compute from the registry alone yet.
- `engine_channel_id` is not settable through these endpoints; connecting an account to the
  operational engine is separate work (Woluman's adapter), not part of H-02.

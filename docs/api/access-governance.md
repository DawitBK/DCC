# Access governance: people and roles (H-03)

Owner: Hirko. Lets DCC add a new company and its people "in under a day without code changes" -
grant and revoke roles without touching code. Tables (`users`, `memberships`) and their row-level
security already existed (platform foundation); this module adds the write operations.

## Role-grant scope (confirmed with Dawit)

- A **company administrator** may grant or revoke any **company-scoped** role - including another
  `company_admin` - inside their **own company only**. They can never grant a group-level role.
- A **group-level** role (`group_admin`, `group_cto`, `security_admin`, `group_marketing`) can only
  be granted by someone who already holds a group-level permission themselves.
- **Self-grant is always refused**, in any scope. This is enforced in the service - RLS and
  `authz.can` alone would permit a company_admin to grant themselves another role in their own
  company, so that one check has to live above them.

This is enforced twice, independently: in `AccessGovernanceService` (`roleAllowedAtScope` +
`authz.can`), and by the database itself (RLS on `memberships`, plus the `membership_role_scope`
check constraint that refuses a group-only role with a company id or vice versa - see
`test/tenant-isolation.test.ts`).

## Not decided yet

- Whether revoking the last `company_admin` of a company needs a safeguard (a company left with
  nobody who can manage it). Not built - raised as an open question, not guessed at.

## Permissions

`user.read` (list) and `user.manage` (grant/revoke). Both already existed in
`contracts/permissions.ts`; H-03 added no new permission.

## Endpoints

| Method | Path                   | Permission    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ---------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/users`           | `user.read`   | People visible to the caller (RLS: themselves, plus anyone sharing a scope they manage), each with their memberships (also RLS-scoped).                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/api/memberships`     | `user.manage` | `companyId` omitted = a group-level grant, in the caller's own group (mirrors how `CompaniesService.create` derives its group - never an arbitrary group id). `companyId` present = a company-level grant; the company is loaded under RLS first, so a company the caller cannot see 404s instead of writing. 409 if already granted, 400 if the role cannot be held at that scope or the person does not exist, 403 for a self-grant or a scope the caller does not manage. |
| DELETE | `/api/memberships/:id` | `user.manage` | The membership is loaded under RLS first (another company's membership 404s, not 403), then re-checked against its own scope before deleting.                                                                                                                                                                                                                                                                                                                                |

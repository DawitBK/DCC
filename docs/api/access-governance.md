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

## Giving a new person their first role (added by the architect, 2026-11-14)

A person appears in DCC the first time they sign in through the SSO. Until someone gives them a role they are in **nobody's**
people list: row-level security shows a person only through a shared company or group, which is right. So the administrator cannot
pick them from a list, and cannot know their id.

`POST /api/memberships` therefore takes the person by **`email`** instead of `userId` (exactly one of the two):

```json
{ "email": "new.person@kerchanshe.example", "companyId": "<company id>", "role": "content_creator" }
```

- The person must have signed in to DCC once. Otherwise: 400 "That person has not signed in to DCC yet. Ask them to sign in once,
  then give the role again."
- The email must be complete and exact (upper or lower case does not matter). There is no search.
- Every other rule is unchanged: the caller's permission for the scope is checked first, self-grant is refused, the grant is audited.
- The lookup is the database function `access_find_user_by_email` (migration `202611141000`): it answers only for a caller who
  already acts for a company or group, and returns an id only. Tests: `test/first-role.e2e.test.ts`.

The order for onboarding a person is: they set up the authenticator app, sign in to DCC once (they see "no role yet"), the
administrator gives the role by email, they reload.

## Not decided yet

- Whether revoking the last `company_admin` of a company needs a safeguard (a company left with
  nobody who can manage it). Not built - raised as an open question, not guessed at.

## Permissions

`user.read` (list) and `user.manage` (grant/revoke). Both already existed in
`contracts/permissions.ts`; H-03 added no new permission.

## Endpoints

| Method | Path                   | Permission    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ---------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/users`           | `user.read`   | People visible to the caller (RLS: themselves, plus anyone sharing a scope they manage), each with their memberships (also RLS-scoped).                                                                                                                                                                                                                                                                                                                                                                        |
| POST   | `/api/memberships`     | `user.manage` | `companyId` omitted = a group-level grant, in the caller's own group (mirrors how `CompaniesService.create` derives its group - never an arbitrary group id). `companyId` present = a company-level grant; the company is loaded under RLS first, so a company the caller cannot see 404s instead of writing. 409 if already granted, 400 if the role cannot be held at that scope, the person does not exist or (by email) has not signed in yet, 403 for a self-grant or a scope the caller does not manage. |
| DELETE | `/api/memberships/:id` | `user.manage` | The membership is loaded under RLS first (another company's membership 404s, not 403), then re-checked against its own scope before deleting.                                                                                                                                                                                                                                                                                                                                                                  |

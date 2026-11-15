# Company onboarding checklist, with evidence (L-22)

Owner: Dawit signs readiness; Abenezer runs it. This is the detailed version of the nine steps in
[docs/onboarding](../onboarding/README.md): the same steps, each with **what proves it is done**.

**State on 2026-11-14: no company has been onboarded.** The checklist is ready for the pilot.

**Copy this page into the private tracker for each company** and fill it there. The filled copy holds names of people and
account details, so it does **not** come back into this public repository. Only the result does: "Company X onboarded on
(date), signed by (role)".

## Before you start

- [ ] The release in use has passed its security review, and the pilot's entry conditions are met ([pilot plan](PILOT-PLAN.md)).
      No real account is connected before that (assumption ASM-07).
- [ ] The company has a sponsor who has told the team that official posts go through DCC from the go-live day.

## The steps

| #   | Step                                                                                                                                                | Who                             | Proof (what you check, not what you are told)                                                                                              | Done |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 1   | Everyone who will use DCC has set up the authenticator app in the SSO portal                                                                        | Abenezer                        | each person signs in to DCC once (they see "no role yet": that first sign-in is also what lets an administrator give them a role by email) | [ ]  |
| 2   | Company and brands exist in DCC, with the right names                                                                                               | Group administrator             | the company and its brands are on the companies screen; `company.created` and `brand.created` in the audit trail                           | [ ]  |
| 3   | Every official account is in the registry: platform, name, public link, brand, status                                                               | Abenezer, company administrator | the count in DCC equals the count in the inventory; no passwords or recovery codes anywhere in DCC                                         | [ ]  |
| 4   | Every account has an owner **and** a backup administrator, both real people still in the company                                                    | Abenezer                        | the registry-gaps report shows nothing for this company                                                                                    | [ ]  |
| 5   | On each network itself: two-factor sign-in is on, and the owner and the backup administrator can both get in                                        | account owner                   | the owner shows it; the backup administrator signs in once in front of Abenezer                                                            | [ ]  |
| 6   | Recovery contacts of each account (email, phone) belong to the company, not to a person's private address                                           | account owner                   | checked on the network's own settings page                                                                                                 | [ ]  |
| 7   | Roles are given: one company administrator, and at least one creator, one approver and one publisher who are **different people**                   | company administrator           | the people screen; each person's `/me` shows the role; `access.membership_granted` events                                                  | [ ]  |
| 8   | Nobody has more than they need: no extra administrators, no approver who is also the only creator                                                   | Dawit                           | read the list of memberships with the sponsor                                                                                              | [ ]  |
| 9   | The approval rule for this company is agreed and set from the signed Group matrix                                                                   | Abenezer, Hirko                 | the sponsor's sign-off; a test post follows the agreed path                                                                                | [ ]  |
| 10  | Each account is connected through the network's official authorisation, by its owner                                                                | Woluman, account owner          | the account shows as connected; nobody typed a password into DCC or Postiz                                                                 | [ ]  |
| 11  | A test post goes the whole way on each connected account: written, approved by a different person, published, visible on the network, then removed  | creator, approver, publisher    | the publication record and five audit events; the post seen on the network                                                                 | [ ]  |
| 12  | The controls are shown to the team, on a test post: the creator cannot approve it; an unapproved post cannot be published                           | Abenezer                        | both refusals seen, with their messages                                                                                                    | [ ]  |
| 13  | Freeze drill: the administrator freezes the company, a publish is refused, the freeze is lifted                                                     | company administrator           | `publishing.frozen` and `publishing.unfrozen` events; the notifications arrived                                                            | [ ]  |
| 14  | Everyone attended their training session                                                                                                            | Abenezer                        | attendance list; each person did their own task without help at the end                                                                    | [ ]  |
| 15  | The company knows who to call, and what to do if a publish outcome is not known or an account looks taken over                                      | Dawit                           | the support contact and the two instructions are in the company's hands                                                                    | [ ]  |
| 16  | The old ways in are closed: people who are not the owner or the backup administrator no longer hold the accounts' passwords; passwords were changed | account owner                   | the owner confirms the change on each network                                                                                              | [ ]  |
| 17  | User acceptance test for this company passed                                                                                                        | Abenezer                        | the [UAT scripts](../testing/UAT-SCRIPTS.md) for the roles this company uses                                                               | [ ]  |
| 18  | Readiness signed                                                                                                                                    | Dawit, the sponsor              | both names and the date                                                                                                                    | [ ]  |

## After go-live

- [ ] Day 1, day 3, day 7: Abenezer compares the posts on each account's own feed with the publications in DCC. A post that is on
      the network and not in DCC is a bypass: find out why, the same day.
- [ ] Day 30: access review. Read the company's memberships with its administrator; remove what is no longer needed. Repeat
      every quarter and whenever someone leaves or changes job.
- [ ] Day 30: end of hypercare, if the month was clean.

## When someone leaves the company

Their account is disabled in the SSO by HR's normal process: their DCC session ends at once, and they cannot sign in again.
Then, the same day: if they were an account owner or backup administrator, name a new one in the registry and change that
account's password on the network; remove their DCC roles so the people list stays true.

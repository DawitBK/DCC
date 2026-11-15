# Training (L-20)

Owner: Dawit. Demonstrations: Rahel. Attendance and feedback: Abenezer.

**State on 2026-11-14:** the approach and the role guides are written. The guides describe what each role does and what the
system refuses, which is already built and tested. **The click-by-click steps and the screenshots are not written**, because
most screens are not connected yet (R-06); they are added to each guide when its screen is final. No session has been held.

## Approach

- **By role, not by feature.** A person learns the two or three things their role does, on their own company's test data.
- **Short.** Executives 30 minutes; everyone else 60 to 90 minutes, hands on, on the test server.
- **Explain the refusals.** Most support calls will be "it would not let me". Every guide lists what the system refuses for
  that role and why, in the system's own words.
- **Before the session, not during it:** each person sets up the authenticator app in the SSO portal. Without it they cannot
  sign in, and the session is lost.
- **Never on real accounts.** Training uses the test server and fictional companies.

## Sessions

| Audience                                     | Length | Content                                                                                          | Guide                                                                                  |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Everyone (start of every session)            | 10 min | what DCC is for, signing in with two factors, "sign in again", who to ask                        | [Everyone](ROLE-GUIDES.md#everyone)                                                    |
| Executives and Group marketing               | 30 min | the approval queue, deciding, what your approval means, reports                                  | [Approvers](ROLE-GUIDES.md#approvers)                                                  |
| Marketing managers and content creators      | 90 min | writing, versions, sending for approval, corrections, why you cannot approve your own words      | [Creators](ROLE-GUIDES.md#content-creators-and-marketing-managers)                     |
| Reviewers and publishers                     | 60 min | commenting, publishing approved posts, what "frozen" means, what to do when a publish is unclear | [Reviewers](ROLE-GUIDES.md#content-reviewers), [Publishers](ROLE-GUIDES.md#publishers) |
| Company administrators                       | 60 min | accounts, owners and backup administrators, giving and removing roles, the freeze                | [Administrators](ROLE-GUIDES.md#company-and-group-administrators)                      |
| Group CTO, security administrators, auditors | 60 min | the audit trail, export, verification and checkpoints, incidents, the freeze                     | [Security and audit](ROLE-GUIDES.md#group-cto-security-administrators-and-auditors)    |

## Materials

| Material                                        | State                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| [Role guides](ROLE-GUIDES.md) (quick reference) | written; steps and screenshots to add per screen                       |
| Demo script for the trainer                     | the nine-step scenario in the [UAT scripts](../testing/UAT-SCRIPTS.md) |
| Short videos per role                           | after the screens are final                                            |
| In-app help                                     | later; the guides are written so their text can be reused              |
| Amharic versions                                | after the English text is stable                                       |

## After each session

Abenezer collects: who attended (for the onboarding checklist), the questions asked, and what people could not do alone.
Questions asked twice become a line in the guide. A task several people could not do alone is a usability finding for Rahel,
not a training problem.

# User acceptance test scripts, one per role (L-18)

Owner: Dawit. Run by: Abenezer with one business user per role, on the test server, with test people and fictional companies.
Each script is what that role **must be able to do** and what it **must not**. Both halves matter: a role that can do too much
is a failed test.

The permissions come from one table, `portal/contracts/src/permissions.ts`. If a script here and that table disagree, the table
is what the system does: report the disagreement to Dawit, do not "fix" the script.

## How to run a script

1. Sign in as the test person for the role (password and authenticator code).
2. Do each line. Write **pass** only if you saw the expected result yourself.
3. For a failure, copy the **request id** from the message on the screen.
4. Sign out. Hand the sheet to Abenezer, who files one issue per failure.

Until the screens for a step exist, that step is marked "waits for screen" and is not a failure.

## Roles at Group level

### Group administrator

| Must be able to                                                                                                                  | Must not be able to                                |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| See every company, brand, account, person and item of the Group                                                                  | Create, submit, review, approve or publish content |
| Create a company and a brand                                                                                                     | Read or export the audit trail                     |
| Register a social account; set its owner and backup administrator; change its status                                             | Open or change an incident                         |
| Grant and remove any role in any company, and group-level roles (after signing in again if the sign-in is older than 15 minutes) | Grant themselves a role                            |
| Freeze publishing for a company or one account, and lift it (lifting asks for a recent sign-in)                                  | See anything of another group                      |

### Group CTO and Security administrator (same rights)

| Must be able to                                                            | Must not be able to                           |
| -------------------------------------------------------------------------- | --------------------------------------------- |
| See everything of the Group                                                | Create or change companies, accounts or roles |
| Read, search and export the audit trail (export asks for a recent sign-in) | Create, approve or publish content            |
| Verify the audit chain                                                     |                                               |
| Open, update and resolve incidents                                         |                                               |
| Freeze and lift a freeze                                                   |                                               |

### Group marketing

| Must be able to                                                   | Must not be able to                                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| See everything of the Group                                       | Create or publish content                                                         |
| See the approval queue of every company; comment, approve, reject | Approve an item they wrote a version of (they cannot write, so this cannot arise) |
| Receive a notification when any company submits content           | Change accounts, roles or freezes; read the audit trail                           |
| Read incidents                                                    | Open or change an incident                                                        |

### Auditor

| Must be able to                                                      | Must not be able to                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| See companies, brands and accounts in their scope                    | See content items or people                                                           |
| Read, search and export the audit trail in their scope; read reports | Change anything at all: every button that changes data is absent, and the API refuses |

## Roles at company level

Run each of these in company A, and for every "must not" also try the same on a record of company B: the answer must be
"not found".

### Company administrator

| Must be able to                                                                                | Must not be able to                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| See everything of their company                                                                | Create a company                                                                     |
| Create brands; register and manage social accounts                                             | Create, approve or publish content                                                   |
| Grant and remove company-level roles in their company, including another company administrator | Grant a group-level role; grant anything in another company; grant themselves a role |
| Freeze and lift a freeze for their company                                                     | Read the audit trail; change an incident                                             |

### Company executive

| Must be able to                                     | Must not be able to                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| See everything of their company                     | Create or edit content                                                   |
| Comment, approve, reject; publish approved content  | Publish content that is not approved, or to a frozen or archived account |
| Open and manage incidents; freeze and lift a freeze | Manage accounts or roles                                                 |

### Company marketing manager

| Must be able to                                                                 | Must not be able to                                                                      |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Create, edit and submit content                                                 | **Approve, reject or comment on an item if they wrote any version of it**, even one line |
| Approve and reject content written entirely by others; publish approved content | Manage accounts, roles or freezes                                                        |
| Read incidents                                                                  | Open or change an incident                                                               |

### Content creator

| Must be able to                                                            | Must not be able to                |
| -------------------------------------------------------------------------- | ---------------------------------- |
| Create, edit and submit content for their company                          | Review, approve, reject or publish |
| See the decision and the comments on their items; receive the notification | See people, reports or incidents   |

### Content reviewer

| Must be able to                                                  | Must not be able to                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| See content; comment on a submitted item ("request corrections") | Approve or reject (the buttons are absent and the API refuses) |
|                                                                  | Create, edit or publish                                        |

### Publisher

| Must be able to                                                           | Must not be able to                                                                                |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| See content; publish an **approved** item to one of its approved accounts | Publish a draft, a rejected item, an older version, or to an account the item was not approved for |
| See the publication record                                                | Create, edit, review or approve                                                                    |

## One scenario for everyone together (30 minutes, the acceptance demo)

1. The creator of company A drafts a post for the company's page and submits it.
2. The reviewer comments: "change the date".
3. The creator edits (a new version) and submits again.
4. The marketing manager approves. (Try first with the creator's own account: refused.)
5. The publisher publishes. The item says published; the publication record shows who asked and who approved.
6. The company administrator freezes the company. The publisher tries a second approved post: refused.
7. The company administrator lifts the freeze (signs in again if asked). The post goes out.
8. The Group CTO opens the audit trail: every step above is there, with the right person and time, and the chain verifies.
9. The administrator of company B looks for the post by its address: "not found".

## Sign-off

UAT is passed when every script has no failure in the "must not" column, every "must" either passes or is marked "waits for
screen" with a task behind it, and the scenario runs from 1 to 9 without help. Abenezer and the Group marketing lead sign;
Dawit countersigns the security half.

## State on 2026-11-14

**Not run.** The rules in these scripts are enforced by the API and covered by automated tests; the scripts wait for the
screens (R-06) and the test server (D-04). The "must not" rules about another company, self-approval, frozen and archived
accounts were re-checked by automated attack tests on 2026-11-14.

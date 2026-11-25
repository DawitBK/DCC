# Incident categories, playbooks and recovery contacts (task H-06, decision D-27): working version 0.1

**Status: working defaults, adopted on 2026-11-25 on the owner's instruction.** The source named for this content was section 4B of the confidential team document, which is not in this repository and was not available. These defaults are written instead from the proposal's own incident journey (section 9.3), its list of alerts (section 12.3) and its compliance line "NIST SP 800-61 aligned" (section 12.5). They are **generic on purpose**: no name, address, phone number or account detail of any real person or company. When the real section 4B arrives, edit the categories and playbooks on the Incidents screen (no code change) and update this page.

The structure was built in pull requests 91 and 93: incident categories (group default or per company), one optional playbook per category (a title and up to 30 plain-text steps), and recovery contacts per company.

## 1. The incident journey every playbook follows

From the proposal, section 9.3:

1. **Detect**: an alert fires, or a person notices.
2. **Triage**: the Group CTO or the security administrator confirms it and sets the severity. **One click freezes publishing** for the account or the company.
3. **Contain and recover**: use the recovery contacts and backup administrators, revoke tokens and sessions, reset credentials.
4. **Communicate**: Communications issues an approved public statement if one is needed (it goes through DCC approval like any post, category `crisis`).
5. **Review**: a post-incident note and lessons learned, kept in the incident record.

Severity (the four levels DCC has):

| Severity     | Meaning in this working version                                                                          | Example                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **critical** | an official account is controlled by someone else, or false statements are going out in the Group's name | a hijacked account that is posting                        |
| **high**     | a real risk to an account or to the Group's reputation, not yet confirmed as a loss of control           | an unexpected administrator added, a post nobody approved |
| **medium**   | something is broken or exposed but contained                                                             | an expired connection, a missing backup administrator     |
| **low**      | a nuisance or a near miss                                                                                | a typo in a published post that was corrected             |

Status moves open, investigating, resolved, closed.

## 2. The categories and their playbooks

Seven group-default categories. A company may add its own. Each playbook is **step lines of plain text** as entered in DCC; the numbers below are the order.

### account-compromise: Account compromise or hijack

1. Freeze publishing for the affected account (Publishing, Freeze) with the reason "suspected compromise".
2. Set the incident severity to critical and tell the Group CTO and the security administrator.
3. Open the network's own security page and recover the account with the recovery contact on file; remove any administrator or app you do not recognise.
4. Unlink the account's engine channel in Social accounts, and link it again only once the account is clean.
5. Change the password and the second factor of every person who could sign in to the account.
6. Check the audit trail and the network's activity for posts, deletions and changes since the first sign of trouble.
7. If false content was published, delete it and ask Communications for an approved statement.
8. Write the lessons learned in the incident record, then close it.

### unauthorised-post: Post published without approval, or published by mistake

1. Freeze publishing for the account if more posts may follow.
2. Find the post and who published it (Publishing and the audit trail).
3. Take the post down if it is wrong or harmful; keep a copy of the text and a screenshot as evidence.
4. If the post was made outside DCC (directly on the network or in the engine), treat it as a possible compromise and also follow the account compromise playbook.
5. Ask the company marketing manager whether a correction or an apology is needed; it goes through approval as a crisis post.
6. Record the cause and what stops it happening again, then close.

### token-expired: Connection to a network expired, was revoked or fails

1. Open Social accounts and find the account marked as needing attention.
2. Ask the account owner or the backup administrator to reconnect it from the network's own login (never share a password).
3. Check that scheduled posts for that account did not fail; reschedule any that did.
4. If the connection was revoked without anyone asking for it, treat it as medium or higher and look for an unknown administrator.
5. Close when posting works again.

### admin-change: Unexpected administrator or recovery-detail change

1. Confirm with the account owner whether the change was planned.
2. If it was not, freeze publishing for the account and set the severity to high.
3. Remove the unknown administrator on the network; restore the recovery email and phone to the corporate ones.
4. Check connected apps on the network and remove any you do not recognise.
5. Record who made the change and how, and close.

### impersonation: Fake or look-alike account

1. Collect the address of the fake account and screenshots of what it posts.
2. Report it to the network using its impersonation form, from the official account owner.
3. Ask Communications whether to warn followers; the warning is a crisis post and needs approval.
4. Keep watching until the account is removed, then close.

### reputational-crisis: Public complaint or story that is gaining ground

1. Tell the company executive and the Group marketing and communications lead at once.
2. Pause scheduled posts that could look careless next to the story (freeze the company if needed).
3. Agree the facts and one spokesperson before anything is published.
4. Prepare the statement as a post in the crisis category; it needs the company executive's approval.
5. Watch the inbox and comments; assign replies to one named person.
6. Review afterwards: what was said, what worked, what to change in this policy.

### engine-outage: The publishing engine or a network is down

1. Check the Security center and the engine status; confirm it is not only your own connection.
2. Do not publish the same post twice: use "Check with the engine" on any post that shows still waiting.
3. If the engine is down, tell the Group CTO; posts stay safe in DCC and are not lost.
4. Tell the marketing team which posts are delayed and for how long.
5. When the engine is back, check scheduled and waiting posts one by one, then close.

## 3. Recovery contacts

Contacts need a real person's details, so **none are shipped**. Each company administrator enters them on the Incidents screen. The working list of **roles to cover** for every company, so nothing is forgotten:

| Contact role                                          | Why                                                       | Channel                                |
| ----------------------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| Company administrator                                 | first person to call for access to the company's accounts | company phone                          |
| Account owner (one per account)                       | knows the account's history and holds its recovery route  | company email                          |
| Backup administrator (one per account)                | can act when the owner is away                            | company email                          |
| Group security administrator (the Group CTO's office) | confirms severity, can freeze the Group                   | company phone                          |
| Group marketing and communications lead               | approves public statements                                | company email                          |
| Each network's business support route                 | the way to recover an account when the owner cannot       | the network's own form or support page |

Use company phone numbers and company email addresses only. Personal details never go into DCC's contact list if a company address exists, and never into this repository.

## 4. Assumptions made

| ID   | Assumption                                                                                                                                                                                                | If it is wrong                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| IP-1 | The seven categories cover the incidents the proposal lists (hijack, unexpected posting, expired or revoked tokens, admin and recovery-detail changes) plus impersonation, reputational crisis and outage | add or archive a category on the Incidents screen        |
| IP-2 | The default list lives at **group level**, and a company adds its own on top (the question left open in D-27)                                                                                             | move a category to a company; no code change             |
| IP-3 | Group CTO and security administrator manage the group list; company executives manage their own company's incidents (what the code already does)                                                          | change the roles in permissions.ts (Dawit)               |
| IP-4 | Playbook steps are guidance for people, not automation; DCC freezes publishing only when a person clicks                                                                                                  | automatic freezing is a separate, approved task          |
| IP-5 | The four severities are enough for the pilot                                                                                                                                                              | a fifth level is a contract change                       |
| IP-6 | The proposal's NIST SP 800-61 alignment is met in structure (detect, triage, contain and recover, communicate, review); a formal alignment review is out of the pilot                                     | schedule that review before a wider rollout              |
| IP-7 | Incident text is public-safe: no personal data, no passwords, no screenshots of private messages go into an incident record                                                                               | tell the author to remove it and note it in the incident |

## 5. How to enter them

`node scripts/demo/load-working-defaults.mjs` enters these seven categories and playbooks on the dev or mirror environment (see the top of that file). On the live server the Group CTO or the security administrator enters them from the Incidents screen, one category at a time, copy and paste from this page. Contacts are always entered by hand.

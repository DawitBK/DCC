# Approval and publishing policy (task A-05): working version 0.1

**Status: a working policy, adopted on 2026-11-25 on the owner's instruction** ("use your best judgement from the proposal and the collected material, make an educated guess, record the assumptions, and do not let this block the project"). It is **not signed** by the Group marketing lead. It exists so that the approval rules can be entered, tested and used in the pilot now. When a signed matrix arrives, change the rules on the Approval rules screen (no code change) and update this page.

Every guess is written down in section 6 with what would change if it were wrong. Nothing here needs a new feature: it uses the approval-rule mechanism that is built and tested (task H-09).

## 1. Where this comes from

| Source                                                                                            | What it gave                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| The proposal, section 12.2 (the approval matrix)                                                  | six kinds of content and who has authority over each                                                         |
| The proposal, section 7.3 (roles)                                                                 | what each of the eleven DCC roles may do                                                                     |
| [CURRENT-PROCESSES](CURRENT-PROCESSES.md): the Corporate Marketing & Communications questionnaire | the real routine today: a review, then a final approval by the manager **or a delegate**; no time limits yet |
| The code: [permissions.ts](../../portal/contracts/src/permissions.ts)                             | only three roles can approve at all: company marketing manager, company executive, Group marketing           |

## 2. The matrix

DCC's rule is "how many **different** people, from which roles, must approve". The six kinds of content are entered as content categories (the Group's list); each company gets one rule per category plus a default.

| Category (key)                                   | Typical content                                                                       | Who may approve (DCC roles)                  | Different approvers needed | Who publishes                               | Proposal authority it stands for            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------- | ------------------------------------------- | ------------------------------------------- |
| Routine operational update (`routine`)           | opening hours, event reminders, job posts, day-to-day notices                         | company marketing manager                    | 1                          | publisher, or the company marketing manager | Company Marketing Manager                   |
| Product and promotional campaign (`campaign`)    | product launches, offers, campaigns                                                   | company marketing manager, Group marketing   | 1                          | publisher, or the company marketing manager | Company Marketing Manager / Communications  |
| Group-level announcement (`group-announcement`)  | statements in the name of the whole Group, shared across companies                    | Group marketing                              | 1                          | publisher of the Group's own company        | Group Marketing and Communications manager  |
| Financial and investor-related (`financial`)     | results, financial figures, anything an investor or bank may read                     | company executive, Group marketing           | **2**                      | publisher                                   | Authorised Finance and Executive Management |
| Crisis, legal or reputational (`crisis`)         | a response to an incident, a legal matter, a public complaint that is gaining ground  | company executive                            | 1                          | publisher, or the company executive         | CEO / COO / designated executive            |
| Sensitive corporate statement (`sensitive`)      | ownership, leadership changes, regulatory matters, anything the Group marks sensitive | company executive, Group marketing           | **2**                      | publisher                                   | Group-authorised executive                  |
| **Everything else** (the company's default rule) | a post with no category chosen                                                        | company marketing manager, company executive | 1                          | publisher, or the company marketing manager | the safe minimum                            |

Always on top, and not configurable: **nobody who wrote any version of a post may review, approve or reject it** (assumption ASM-13, built and tested). A post whose approval was granted for one version does not carry over to a changed version.

## 3. The routine in words

1. A **content creator** writes the post and submits it. (The company marketing manager may also write and submit; they then cannot approve their own post.)
2. A **content reviewer** or marketing expert reads it and comments: completeness, tone, facts. Comments are on record. DCC does not force a review before an approval in the pilot (assumption AP-4).
3. The approvers named in the table above approve. If two are needed, they must be two different people, neither of whom wrote any version.
4. The **publisher** publishes or schedules it. Publishing is refused if a freeze is active, if the post is not approved, or if the approval was for an older version.
5. Every step is on the audit trail with who, when and which version.

## 4. Time limits: targets, not machinery

No department has given a response time (every route in the Marketing questionnaire says "SLA: to confirm"). Building a timer into the software would invent a business rule, so the pilot uses **targets that people follow and managers watch on the Approvals screen** (decision D-26, now closed this way):

| Category             | Review target  | Approval target |
| -------------------- | -------------- | --------------- |
| Routine, campaign    | 1 working day  | 1 working day   |
| Group announcement   | 1 working day  | 2 working days  |
| Financial, sensitive | 2 working days | 3 working days  |
| Crisis               | 30 minutes     | 1 hour          |

**What happens when a target is missed:** the requester asks the next person up by hand (the company marketing manager, then the company executive, then Group marketing). An expired request is **never approved automatically**, and DCC does not escalate by itself. If the pilot shows that this is too loose, a reminder notification is a small, separate task with its own tests (see D-26).

## 5. Delegation

The Marketing questionnaire allows a "delegated approver" on 32 of 37 approval steps. In DCC a delegate is simply **a second person who holds the approving role** in that company (for example a second company marketing manager). The rule says "any person from these roles", so no special delegation feature is needed. Giving or removing the role is the delegation, and it is on the audit trail (it also asks for a recent sign-in). Assumption AP-5.

## 6. Assumptions made (replace with the signed matrix when it exists)

| ID   | Assumption                                                                                                                                                                  | If it is wrong, what changes                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| AP-1 | The proposal's six categories are the Group's complete list for posts (the Marketing questionnaire's 14 categories are about documents, not posts)                          | add or archive a category on the Approval rules screen                                                                 |
| AP-2 | "Authorised Finance" has no DCC role (there are eleven roles, none for finance), so a financial post needs **two** approvers from the company executive and Group marketing | change the count or the roles of one rule; if Finance must approve, a role change is a task for Dawit (permissions.ts) |
| AP-3 | A crisis post needs **one** executive, because speed matters and the proposal lists three equal alternatives (CEO / COO / designated executive)                             | raise the number to 2 on the crisis rule                                                                               |
| AP-4 | Review then approval is a habit, not a lock: DCC records review comments but allows an approval without one                                                                 | an ordered stage is a new feature (D-26), only if the signed matrix says so                                            |
| AP-5 | A delegate is a second holder of the approving role                                                                                                                         | a delegation with dates is a new feature                                                                               |
| AP-6 | The two "two approvers" rules count two different people from the allowed roles; two company executives would satisfy it (DCC does not require one of each role)            | "one of each" is a new feature                                                                                         |
| AP-7 | Every post on a Group social account goes through DCC approval. The "owner publishes directly, no approval" routes of today stay for documents and never apply to a post    | none: this is the reason DCC exists                                                                                    |
| AP-8 | The response targets in section 4 are reasonable starting points                                                                                                            | edit this page; nothing in the software depends on them                                                                |
| AP-9 | The pilot company is Corporate (D-16); the same rules are entered for any company added later                                                                               | enter or change the rules for that company                                                                             |

## 7. How to enter the rules

On the dev and mirror environments: `node scripts/demo/load-working-defaults.mjs` (see the comment at the top of that file for the exact command per environment). It enters the content categories, the incident categories with their playbooks ([INCIDENT-PLAYBOOKS](../security/INCIDENT-PLAYBOOKS.md)) and the approval rules for one company, through the API, as a signed-in administrator. Run twice, it changes nothing the second time.

On the live server the Group administrator enters the same by hand: **Approval rules** screen, one rule per category and company. The screen asks for a recent sign-in first. Ten minutes.

## 8. Who signs

By decision D-17, Abenezer collects and Dawit approves. The Group marketing lead (the person who signs the matrix) reads sections 2, 4 and 6 and answers "yes" or names the rows to change. Until then this page is the working rule.

# Approval and publishing policy (task A-05): working version 0.2

**Status: a working policy, adopted on 2026-11-25 on the owner's instruction** ("use your best judgement from the proposal and the collected material, make an educated guess, record the assumptions, and do not let this block the project"). It is **not signed** by the Group marketing lead. It exists so that the approval rules can be entered, tested and used in the pilot now. When a signed matrix arrives, change the rules on the Approval rules screen (no code change) and update this page.

**Version 0.2 (2026-11-26):** the Marketing & Communications team answered Round 2 and marked this matrix, the general rules and the numbers "Agree" ([ROUND2-MARKETING-INTAKE](ROUND2-MARKETING-INTAKE.md)). It has twelve categories (v0.1 had six), real time limits, and rules DCC does not have yet. The workbook is still not signed, and its approval matrix sheet has a copy-and-paste error (intake 4.1) that is ignored until the marketing lead confirms.

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

| Category (key)                                   | In the team's words: reviewer, then approver(s)                                                                                                             | Who may approve (DCC roles)                  | Different approvers                    | Time limit                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------- | -------------------------- |
| Routine post (`routine`)                         | Digital Marketing Manager, then the Marketing & Communications Manager                                                                                      | company marketing manager                    | 1                                      | 24 office hours            |
| Ads and offers (`ads-and-offers`)                | Digital Marketing Manager and a Business Unit representative, then the M&C Manager; **plus the Business Unit Head if a price, discount or claim is stated** | company marketing manager, company executive | **2** (see AP-11)                      | 24 office hours            |
| Partner or customer mention (`partner-mention`)  | Digital Marketing Manager and the relationship owner, then the M&C Manager; **written consent on file**                                                     | company marketing manager                    | 1                                      | 24 office hours            |
| Campaign (`campaign`)                            | Digital Marketing Manager and a Business Unit representative, then the M&C Manager and the Business Unit Head                                               | company marketing manager, company executive | **2**                                  | 48 office hours            |
| Group announcement (`group-announcement`)        | M&C Manager and the Department Head, then the M&C Manager and the CEO or authorised Senior Management                                                       | Group marketing, company executive           | **2**                                  | 24 office hours            |
| Executive or leadership (`executive`)            | M&C Manager or the Executive Office, then the Executive Office and the CEO or authorised Senior Management                                                  | company executive                            | **2**                                  | 48 office hours            |
| Financial (`financial`)                          | Finance Manager, then the Head of Finance and authorised Senior Management                                                                                  | company executive, Group marketing           | **2**                                  | 48 office hours            |
| Legal (`legal`)                                  | Legal Manager, then the Head of Legal and authorised Senior Management                                                                                      | company executive, Group marketing           | **2**                                  | 48 office hours            |
| HR and recruitment (`hr-recruitment`)            | HR representative and the M&C Manager (brand check), then the HR & Administration Manager                                                                   | company marketing manager, company executive | 1                                      | 24 office hours            |
| Crisis (`crisis`)                                | M&C Manager and the Department Head, then the CEO and a second Senior Management member                                                                     | company executive                            | **1 for now** (AP-12; the team says 2) | **1 hour, 24 hours a day** |
| Political or sensitive (`sensitive`)             | M&C Manager (and Legal where needed), then two different Senior Management members                                                                          | company executive, Group marketing           | **2**                                  | 48 office hours            |
| **Everything else** (the company's default rule) | Digital Marketing Manager and a Department representative, then the Department Head or the M&C Manager                                                      | company marketing manager, company executive | 1                                      | 24 office hours            |

**Office hours** are 08:30 to 17:30, Monday to Saturday (Saturday is a working day), public holidays excluded; the clock starts when the post is submitted. The crisis clock never stops.
The team's reviewers who have no DCC role act as **content reviewers** (they comment); the approvals of the Head of Finance, Head of Legal, HR & Administration Manager, Business Unit Heads and the Executive Office are entered as the **company executive's** (AP-10).

Always on top, and not configurable: **nobody who wrote any version of a post may review, approve or reject it** (assumption ASM-13, built and tested). A post whose approval was granted for one version does not carry over to a changed version.

## 3. The routine in words

1. A **content creator** writes the post and submits it. (The company marketing manager may also write and submit; they then cannot approve their own post.)
2. A **content reviewer** or marketing expert reads it and comments: completeness, tone, facts. Comments are on record. DCC does not force a review before an approval in the pilot (assumption AP-4).
3. The approvers named in the table above approve. If two are needed, they must be two different people, neither of whom wrote any version.
4. The **publisher** publishes or schedules it. Publishing is refused if a freeze is active, if the post is not approved, or if the approval was for an older version. **The team's rule that an approval lapses after 7 calendar days is not built** (requirement RQ-024): today an approved version stays approved.
5. Every step is on the audit trail with who, when and which version.

## 4. Time limits: the team's numbers, and what is built

The Marketing team gave real limits in Round 2 (the column above). They are counted in **office hours** (08:30 to 17:30, Monday to Saturday, no public holidays) from the moment the post is submitted; crisis runs on a 24-hour clock.

| Category                                                                | Limit from submission to a decision |
| ----------------------------------------------------------------------- | ----------------------------------- |
| Routine, ads and offers, partner mention, HR, other, group announcement | 24 office hours                     |
| Campaign, executive, financial, legal, sensitive                        | 48 office hours                     |
| Crisis                                                                  | 1 hour, 24 hours a day              |

**What the team wants when a limit is missed:** a reminder to the approver at 50% of the time, the request passes to the stand-in at 100%, the "escalate to" person is told at 150%, and it appears in the monthly executive report at 200%; for a crisis at 15, 30 and 45 minutes.
The post is **never** published or approved by itself in any case.

**What is built today:** none of this. DCC shows when a request was submitted; people watch the clock and ask the next person up by hand (company marketing manager, then company executive, then Group marketing). Notifications on a missed limit are requirement RQ-023 (decision D-26 is reopened for exactly that part).
"24 office hours" is also ambiguous (AP-15): counted in office hours it is about three Monday-to-Saturday days, which is what the team wrote.

## 5. Delegation

The Marketing questionnaire allows a "delegated approver" on 32 of 37 approval steps. In DCC a delegate is simply **a second person who holds the approving role** in that company (for example a second company marketing manager). The rule says "any person from these roles", so no special delegation feature is needed. Giving or removing the role is the delegation, and it is on the audit trail (it also asks for a recent sign-in). Assumption AP-5.

## 6. Assumptions made (replace with the signed matrix when it exists)

| ID    | Assumption                                                                                                                                                                                                                                                            | If it is wrong, what changes                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| AP-1  | The proposal's six categories are the Group's complete list for posts (the Marketing questionnaire's 14 categories are about documents, not posts)                                                                                                                    | add or archive a category on the Approval rules screen                                                                 |
| AP-2  | "Authorised Finance" has no DCC role (there are eleven roles, none for finance), so a financial post needs **two** approvers from the company executive and Group marketing                                                                                           | change the count or the roles of one rule; if Finance must approve, a role change is a task for Dawit (permissions.ts) |
| AP-3  | A crisis post needs **one** executive, because speed matters and the proposal lists three equal alternatives (CEO / COO / designated executive)                                                                                                                       | raise the number to 2 on the crisis rule                                                                               |
| AP-4  | Review then approval is a habit, not a lock: DCC records review comments but allows an approval without one                                                                                                                                                           | an ordered stage is a new feature (D-26), only if the signed matrix says so                                            |
| AP-5  | A delegate is a second holder of the approving role                                                                                                                                                                                                                   | a delegation with dates is a new feature                                                                               |
| AP-6  | The two "two approvers" rules count two different people from the allowed roles; two company executives would satisfy it (DCC does not require one of each role)                                                                                                      | "one of each" is a new feature                                                                                         |
| AP-7  | Every post on a Group social account goes through DCC approval. The "owner publishes directly, no approval" routes of today stay for documents and never apply to a post                                                                                              | none: this is the reason DCC exists                                                                                    |
| AP-8  | The response targets in section 4 are reasonable starting points                                                                                                                                                                                                      | edit this page; nothing in the software depends on them                                                                |
| AP-9  | The pilot company is Corporate (D-16); the same rules are entered for any company added later                                                                                                                                                                         | enter or change the rules for that company                                                                             |
| AP-10 | Roles the team names but DCC does not have (Head of Finance, Head of Legal, HR & Administration Manager, Business Unit Head, Executive Office) are represented by the **company executive** as approver and the **content reviewer** as reviewer, until a role exists | a role-table change (the owner's yes, and tests); the rules are then re-entered                                        |
| AP-11 | "Ads and offers" needs a second approval only if it states a price, discount or claim; DCC cannot make a rule conditional, so the rule asks for two                                                                                                                   | lower the count to 1 on the Approval rules screen                                                                      |
| AP-12 | **Crisis stays at one approver** until an emergency path exists (RQ-025). The team's rule is two approvers with one senior person allowed alone in an emergency; without the emergency flag a rule of two could block a real crisis post                              | set the crisis rule to 2 together with the emergency feature                                                           |
| AP-13 | In the approval matrix sheet "Agree" is the answer; the "if you change" columns, identical in every row, are a pasted example and are ignored until the marketing lead confirms (intake 4.1)                                                                          | enter the rules the lead actually wants                                                                                |
| AP-14 | A Business Unit Head, where the matrix asks for one, is the company executive of that company                                                                                                                                                                         | a role or a per-unit approver is a new feature                                                                         |
| AP-15 | The 24 and 48 hour limits are counted in office hours (about three and about five Monday-to-Saturday days)                                                                                                                                                            | change the numbers on this page; nothing in the software depends on them yet                                           |

## 7. How to enter the rules

On the dev and mirror environments: `node scripts/demo/load-working-defaults.mjs` (see the comment at the top of that file for the exact command per environment). It enters the content categories, the incident categories with their playbooks ([INCIDENT-PLAYBOOKS](../security/INCIDENT-PLAYBOOKS.md)) and the approval rules for one company, through the API, as a signed-in administrator. Run twice, it changes nothing the second time.

On the live server the Group administrator enters the same by hand: **Approval rules** screen, one rule per category and company. The screen asks for a recent sign-in first. Ten minutes.

## 8. Who signs

By decision D-17, Abenezer collects and Dawit approves. Abenezer's Round 2 workbook records the team's "Agree"; **a signature from the Group marketing lead is still missing**, and so are the names that make the stand-ins and approvers real people (sheet B has 2 of 39). The lead reads sections 2, 4 and 6, signs, and settles the open points of the intake (4.1 to 4.10). Until then this page is the working rule.

# Round 2 questionnaire, Marketing: what it says and what we did with it

**Received 2026-11-25 from Abenezer; read in full on 2026-11-26.** The workbook (`DCC_Questionnaire_Round2_Marketing.xlsx`, ten sheets, version 1 of 21 Nov 2026) is **private**: it names real people and
accounts, its own rules say it never goes in the repository, and the repository ignores every `.xlsx`. Here are roles and counts only, never names. The original is kept in `private/` (git-ignored) on the owner's PC.

Abenezer collected it by giving the Marketing & Communications team questionnaires and talking each one through. It is the first answer from the people who will use the system, and it is real work:
it replaces guesses with answers on approval, inbox and incidents. It also has gaps, one copy-and-paste error that would do harm if applied literally, and three disagreements with what Abenezer's message says.
Section 4 lists them, so they can be fixed in one conversation.

## 1. What was answered, honestly counted

The workbook's progress sheet says 100% on most sheets. It counts any non-empty cell, including "To be confirmed by IT Manager". Counted by content:

| Sheet                    | Rows | Real answers                                                                                                                           |
| ------------------------ | ---: | -------------------------------------------------------------------------------------------------------------------------------------- |
| A Accounts               |   40 | Link, page type, status and 2-step login answered for all 40. **No named admin, no named backup admin, recovery phone "No" on all 40** |
| B People                 |   39 | **2 names of 39 roles** (the Digital Marketing Manager and one Content Writer, from Round 1)                                           |
| C1 Approval rules        |   15 | 15 of 15 answered, 14 "Agree" and 1 "No" that contradicts its own text (4.2)                                                           |
| C2 Approval matrix       |   12 | 12 of 12 marked "Agree", but the change columns hold one pasted example row in every category (4.1)                                    |
| D1 Past incidents        |   13 | **0 of 13**: every answer is "To be confirmed by IT Manager"; the incident log is empty                                                |
| D2 Severity & escalation |   26 | 26 of 26 "Agree" to the proposed defaults, plus a few additions (section 3)                                                            |
| E Inbox rules            |   17 | 17 of 17 "Agree" (details in 3.3); four answers are promises to collect information still missing (E-09, E-10, E-16, E-17)             |
| F Priorities & playbooks |   16 | 12 marked "Agree" (one of them, F-07, hands the e-mail domain to the IT Manager); 4 "Don't know" (F-05, F-06, F-15, F-16)              |

## 2. What is confirmed (it stands as written)

- **Rollout order** (F-01 to F-04): wave 1 is the Group and Kerchanshe Coffee (11 accounts); wave 2 is Kerchanshe Auto, Buna Pulse, Kerchanshe Equipment and Kerchanshe Tractor (12); wave 3 is the rest. Facebook and Instagram first, then LinkedIn, YouTube, then TikTok and X.
  This replaces "the pilot company is Corporate" (AP-9, D-16) with **the Group and Coffee**.
- **Incident levels and categories** (D2-01 to D2-15): the four severities with their response times, the ten categories and their default severities, exactly as proposed. The working playbooks ([INCIDENT-PLAYBOOKS](../security/INCIDENT-PLAYBOOKS.md)) already use them.
- **Who is told and who may act** (D2-16 to D2-26): on-call primary and backup for SEV1 and SEV2; a freeze may be started by the IT Manager, the Security Administrator, the Marketing & Communications Manager or the CEO; **lifting a freeze after SEV1 or SEV2 takes two people** (the IT Manager and the Marketing & Communications Manager);
  SEV1 notification list, SEV2 list; SEV1 not acknowledged in 15 minutes goes to the deputy and the Group CTO, after 30 minutes to the CEO office; alerts may also go by SMS and Teams; a post-incident review within 5 business days before a SEV1 or SEV2 closes; every account needs a named backup administrator, a recovery phone and a company-owned recovery e-mail; contact details re-checked every 90 days.
- **The content-incident playbooks** (F-08 to F-14) are realistic for the team as written; the Marketing & Communications Manager drafts a correction or holding statement; the owner of the content category decides to hide or delete a wrong post, with the reason recorded.
- **General approval rules** (C1): nobody reviews or approves their own content; two approvals mean two different authorised people; any change after approval needs a new approval; nothing publishes by itself when an approver is slow; every approver has a named stand-in;
  **an approval stays valid for 7 calendar days**; time limits count in office hours (Monday to Saturday, 08:30 to 17:30, Saturday is a working day, public holidays excluded), the crisis clock is 24/7; one senior person may allow an emergency post alone (documented, second approval afterwards); a written reason is recorded for every deletion or correction of a published post; website content stays outside DCC.
- **The inbox** (E): see 3.3.

## 3. What changes (against the working version of 2026-11-25)

### 3.1 The approval matrix has twelve categories, not six

The team confirmed its own list: Routine post, Ads and offers, Partner or customer mention, Campaign, Group announcement, Executive or leadership, Financial, Legal, HR and recruitment, Crisis, Political or sensitive, Other.
My working version used the proposal's six. Six are added (`ads-and-offers`, `partner-mention`, `executive`, `legal`, `hr-recruitment`; "Other" is the company's default rule). The business names roles DCC does not have: Head of Finance, Head of Legal, HR & Administration Manager, Business Unit Head, Executive Office.
Until a role exists (decision D-29), their approval is entered as the **company executive's**, and where the matrix names them as reviewer they act as **content reviewers** (comments). The mapping and every number are in [APPROVAL-AND-PUBLISHING-POLICY](APPROVAL-AND-PUBLISHING-POLICY.md), section 2.

### 3.2 The time limits are numbers now, and the team wants them enforced

Review-to-decision limits: 24 hours (routine, ads, partner mention, HR, other), 48 hours (campaign, executive, financial, legal, sensitive), 1 hour on a 24/7 clock (crisis), in office hours as above.
A missed limit should remind the approver (at 50%), pass the request to the stand-in (100%), tell the "escalate to" person (150%) and appear in the monthly report (200%); crisis at 15, 30 and 45 minutes.
Decision D-26 closed "no machine-enforced time limits" **only until the signed matrix gave numbers**. It now has them, so D-26 is reopened for the notification part (never for publishing: nothing ever publishes by itself). Not built.

### 3.3 The inbox

| Rule                     | What the team answered                                                                                                                                                                                                                  | DCC today                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Who reads (E-01)         | Digital Marketing Manager, Content Writer, named community responders, each only for their companies. The graphic designer has no access. Abenezer's message adds the CEO with **oversight** access                                     | company marketing manager, company executive, publisher, company administrator and Group marketing read; **content creator cannot** |
| Who replies (E-02)       | Content Writer and community responders (templates, routine); the Digital Marketing Manager anything                                                                                                                                    | company marketing manager, company executive, publisher reply; **content creator cannot**                                           |
| Assignment (E-03, E-04)  | By the Digital Marketing Manager; automatic by company and language; anyone with access may claim an unassigned message; reassignment needs a reason and **does not restart the clock**; after two reassignments it goes to the manager | assignment by anyone with reply access; no reason, no claim, no automatic assignment, no reassignment count                         |
| Targets (E-05, E-12)     | **Urgent 1 hour, normal 4 working hours, low 24 hours**, working hours Monday to Saturday 08:30 to 17:30                                                                                                                                | one target per company in calendar minutes, no priority, no working hours                                                           |
| When late (E-06)         | 100%: reminder to the assignee and the manager; 150%: moved to the backup responder; 200%: the Marketing & Communications Manager is told and it counts in the monthly report                                                           | overdue is shown; nobody is told                                                                                                    |
| Urgent (E-07)            | complaints, safety or quality claims, legal or media enquiries, investor or partner messages, sales enquiries for vehicles, equipment and the hotel                                                                                     | no priority                                                                                                                         |
| Sensitive replies (E-08) | legal threats, media, investors, safety, personal data, refunds or compensation need **approval before the reply is sent**, by the matrix                                                                                               | a reply is sent at once                                                                                                             |
| Moderation (E-14)        | Digital Marketing Manager and Content Writer may **hide** spam and abuse; **deleting and blocking only the Digital Marketing Manager**; all recorded                                                                                    | no moderation action                                                                                                                |
| Other                    | backup responder named per company (E-15); English and Amharic (E-11); an automatic "we received your message" outside office hours, wording approved by the Marketing & Communications Manager (E-13)                                  | not built                                                                                                                           |

**Two of these contradict an owner decision of 2026-11-15** (handover decision 5, which gave the inbox to the marketing manager, executive, publisher and Group marketing): the team wants the **Content Writer**, who is DCC's `content_creator`, to read and reply.
That is a change to the role table, which needs the owner's explicit yes: it is **not** made here (BACKLOG RQ-030).

### 3.4 Other new requirements

Deleting or correcting a **published** post (a written reason every time; who may do it per category); an **emergency post** by one senior person, flagged, with the second approval afterwards; **approval expires after 7 days**; **a freeze is lifted by two people** after SEV1 and SEV2;
a **post-incident review** before a SEV1 or SEV2 closes; **SMS and Teams** alerts (with e-mail, FR-16); the reviewer may **change the category** (C1-08; DCC has the category chosen by the writer). Each has a row in the [requirements register](REQUIREMENTS-REGISTER.md) (RQ-023 to RQ-034) and in the backlog (H-19 to H-22); none is built.

## 4. Problems in the workbook to settle with Abenezer and the marketing lead

1. **C2 is pasted, not answered.** All 12 categories say "Agree", and in all 12 the "if you change anything" columns hold the same text: reviewer "Digital Marketing Manager and Content Writer", approver 1 "Digital marketing manager", approver 2 "Content writer", the same stand-in, escalate to the CEO, 24 hours, and the same sentence under "special rule". That is the example row, copied down.
   Taken literally it would send a Legal or Financial post for approval to the content writer, who wrote it, and would break the team's own C1-01 and C1-03. **Adopted: "Agree" is the answer and the pasted columns are ignored until the marketing lead confirms.** What would change if the paste is meant: nothing in the code, only the rules entered.
2. **C1-13** is marked "No" in the dropdown but its text says website approval stays outside DCC (the proposed answer). Read as "outside DCC".
3. **The CEO.** Abenezer's message says the CEO has oversight access to the inbox; E-01 does not list the CEO. DCC's company executive can already read and reply. Is oversight read-only?
4. **"1 hour" or "1 working hour"** for an urgent message (E-05 says 1 hour; the message says 1 working hour; E-12 says urgent messages outside office hours are covered by a separate arrangement that nobody named).
5. **The escalation order.** The message says: assigned responder, then the Digital Marketing Manager, then the Marketing & Communications Manager. The sheet also has the backup responder at 150%. Which is right?
6. **D1 is empty.** Thirteen questions about the 2026-10-29 incident and past incidents are all "To be confirmed by IT Manager", and the incident log has no rows. The incident module has nothing real to learn from yet.
7. **B People has 2 names of 39 roles.** No stand-ins, no on-call people, no business unit heads, no community responders: the approvals cannot be routed to real people and the on-call duty has nobody.
8. **A Accounts:** every one of the 40 rows lists "IT team (named person needed)" as backup admin, "No" for a recovery phone and the CEO as business owner, and the question whether anyone shares one login is unanswered for all of them. D2-24 requires a named backup administrator and a recovery phone for every account, so **all 40 accounts will show on the registry gaps report until that is fixed**, which is what the report is for.
   Also: seven Facebook addresses are numeric profile addresses (`profile.php?id=`) marked "correct and official" without saying they are Pages and not personal profiles (the Buna Pen, Buna Plate, Oro Meat, AMAM, Kerchanshe Auto, Kerchanshe Tractor and Buna Pulse pages);
   the Oro Meat Instagram address belongs to the handle `gibe.agro`; the Buna Plate LinkedIn address and the Buna Qela X account are still unknown; Gibe Agro Industry and the U Luxury Hotel have no account listed and are marked inactive;
   and the LinkedIn addresses the team corrected are **administrator addresses** (`.../admin/page-posts/...`, which need a login), not the public company page address.
9. **The Group-level numbers** (followers, posts per week, last post, date created) are filled for no account.
10. **Four open questions** need an answer from someone: upcoming campaigns that would move the rollout (F-05), other networks in use such as Telegram (F-06), the legal contact and after-hours route (F-15), and who files platform reports today (F-16). The official e-mail domain (F-07) is with the IT Manager.

## 5. What was done with it (2026-11-26)

- The working policy is now version 0.2 with the team's matrix, numbers and rules ([APPROVAL-AND-PUBLISHING-POLICY](APPROVAL-AND-PUBLISHING-POLICY.md)); the loader `scripts/demo/load-working-defaults.mjs` enters the twelve categories and their rules.
- Assumptions ASM-20 to ASM-23, decision D-30, requirements RQ-023 to RQ-034 and the backlog rows (A-02, A-03, A-05, A-07, H-14 and the new H-19 to H-22) are written; the team's answers and the open points are in each.
- A private account list (`private/round2-accounts.csv`, git-ignored) holds the 40 rows with the links, page types, waves and what is still missing per account, for registering the accounts on the screens.
- Abenezer's page and the owner-only messages carry what he delivered and the specific follow-up questions (section 4).
- **Not built, and why:** everything in 3.2 to 3.4. Each is a feature with a design question (a two-person freeze lift, a reply approval flow, working-hours arithmetic, notifications on lateness). They are specified in the backlog so the next session can start from the rule, not from a conversation. The one change that would be quick, **inbox access for the Content Writer, needs the owner's yes** because it reverses his decision of 2026-11-15.

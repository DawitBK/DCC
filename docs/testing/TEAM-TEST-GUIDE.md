# Team test guide: try to break DCC (round 1, from 2026-11-27)

Owner: Dawit. Written in plain words for everybody on the team, developers and non-developers. **No programming is needed to run most of it.**

**Why this exists.** Since 2026-11-25 Dawit rebuilt the screens and finished most of the backend himself. Code that its own author tests passes too easily. Now people who did not write it must use it the way real staff will, and the way a careless or a bad person might. **Your job is to find what is wrong. A test where you found nothing, after a hard try, is good. A test you did not really do is worse than no test.**

Every statement of "must" and "must not" below was checked against the code and the API pages (`docs/api/`) on 2026-11-27. If what you see differs, that is a finding, not a mistake of yours.

## Rules for every test

1. **Practice data only.** Companies, people, posts and channels are fake. Never type a real password, a real phone number, a real person's data or a real social account. Never put a screenshot with real data in GitHub.
2. **Write what you saw, not what you expected.** "Pass" only if you saw it yourself. If you are not sure, it is not a pass.
3. **One finding, one note.** Use the template at the end. A finding without the steps to repeat it cannot be fixed.
4. **Do not fix other people's findings quietly.** Report first. Dawit owns every area now, and anyone may send a fix as a pull request, but a finding must exist on the list first.
5. **Try the "must not" half as hard as the "must" half.** A role that can do too much is a failure, the same as a role that cannot do enough.
6. **Never merge your own pull request.** Dawit merges.

## Known gaps (do not report these as new; do note if you see them worse than described)

- **"Person 4b5e7da0":** a person the viewer may not list shows as "Person" plus a code. Rahel and Hirko are fixing it.
- **Real networks:** nothing has run on a real Facebook, Instagram, LinkedIn, YouTube, TikTok or X. Only the practice network. The real networks need developer apps.
- **Alerts (SMS, Teams, e-mail):** nothing is sent until IT supplies the addresses and numbers. The screen must say "not configured".
- **Removing a post:** it is proven on the practice network only. Whether Postiz also removes it from a real network is not proven; the dialog tells the person to check the network.
- **The approval matrix** is the working version 0.2 (twelve categories), not signed by the Group marketing lead.

## How to start (two ways to sign in)

### A. Without the company SSO (on your own laptop) - this is how most of you test

Follow [05-RUN-EVERYTHING-ON-YOUR-LAPTOP](../team/05-RUN-EVERYTHING-ON-YOUR-LAPTOP.md) from the top: `git pull` on `develop`, `npm install`, `npm run build:packages`, `npm run db:migrate`, start the backend and the web app, load the sample data, then make a sign-in ticket for a role:

```
npm run dev:session -- creator@example.test content_creator kerchanshe-coffee
```

Paste the long line into the browser as the cookie `dcc_sid` (steps are in section 05). Three things to know about a ticket:

1. It stops working after **30 minutes of not using it**. If a page suddenly asks you to sign in, make a new ticket. That is correct behaviour (and test T1).
2. It counts as "freshly signed in" for only **15 minutes**. After that, the sensitive actions (give a role, remove a role, lift a freeze, set or remove an approval rule, export the audit trail, sign a person out everywhere) are refused with "sign in again". On a laptop there is no SSO to sign in to, so **make a new ticket just before you do such an action**. The real "sign in again" step can be tested only with the real SSO (B).
3. Use **a different browser or a private window per person**, so you can be three people at once. Keep your tickets in a plain note on your own laptop (not in GitHub).

The 11 roles (a company role needs a company name at the end of the command):

| Level   | Roles                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| Group   | `group_admin`, `group_cto`, `security_admin`, `group_marketing`                                                       |
| Company | `company_admin`, `company_executive`, `company_marketing_manager`, `content_creator`, `content_reviewer`, `publisher` |
| Either  | `auditor`                                                                                                             |

The three sample companies are `kerchanshe-coffee`, `kerchanshe-equipment` and `buna-pen-and-plate`.

**Load the working rules once (needed for T3, T4 and T8).** The sample data has no approval rules, content categories or incident playbooks. With the backend running, in PowerShell in the DCC folder:

```
$env:DCC_ADMIN_SESSION = (npm run dev:session --silent -- admin@example.test group_admin | Where-Object { $_ -match '^[A-Za-z0-9_-]{30,}\s*$' } | Select-Object -Last 1).Trim()
$env:DCC_SECURITY_SESSION = (npm run dev:session --silent -- security@example.test security_admin | Where-Object { $_ -match '^[A-Za-z0-9_-]{30,}\s*$' } | Select-Object -Last 1).Trim()
node scripts/run-with-env.mjs .env node scripts/demo/load-working-defaults.mjs
```

It enters the twelve content categories, one approval rule per category for every company, and seven incident categories with playbooks. It is safe to run twice. Run it within 15 minutes of making the two tickets. If it says it cannot, make the tickets again.

The posting engine (Postiz) is optional. Without it DCC uses a **fake engine**: everything works and nothing leaves your laptop. T14 needs the real engine with the practice network (it needs the fork image: see T14).

### B. With the company SSO (the real sign-in)

The real sign-in (password and authenticator code, and the "sign in again" step) runs only on Dawit's PC. You cannot start it on your laptop. Test T1 and the "sign in again" checks only when Dawit sits with you or gives you a test person's sign-in for his PC. **Never share it, never write it in GitHub.** Everything else is the same as in A.

## How to write the result

Make a copy of this table in a note and fill one row per check. **Pass**, **Fail**, or **Could not do it (say why)**.

| Check | Role | What I did | What I saw | Result |
| ----- | ---- | ---------- | ---------- | ------ |

For every failure, write a finding with the template at the end. Send the sheet and the findings to Dawit when you finish a part, not only at the end.

---

## T0. Does it start at all? (10 minutes; everybody)

1. After the setup, open `http://localhost:7716/api/health/live` (or your own port). You should see `{"status":"ok"}`.
2. Open the web app. You should see "Digital Communications Control Center" and a sign-in button. Do **not** press it on your laptop.
3. With a ticket, reload. You should see your name, your role, and a menu on the left.
4. **The menu depends on the role.** There are 21 screens in all. Count the menu entries for each role you try; these are the numbers the code gives (a role is shown only the screens its permissions allow):

   | Role                          | Entries | Not in its menu                                                                                                                                        |
   | ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `group_admin`                 | 16      | Create content, Approvals, Unified inbox, Security center, Activity audit                                                                              |
   | `group_cto`, `security_admin` | 17      | Create content, Approvals, Unified inbox, Approval rules                                                                                               |
   | `group_marketing`             | 16      | Create content, Publishing, Approval rules, Security center, Activity audit                                                                            |
   | `auditor`                     | 11      | Create content, Content library, Approvals, Content calendar, Publishing, Unified inbox, Access governance, Approval rules, Incidents, Security center |
   | `company_admin`               | 17      | Create content, Approvals, Security center, Activity audit                                                                                             |
   | `company_executive`           | 17      | Create content, Approval rules, Security center, Activity audit                                                                                        |
   | `company_marketing_manager`   | 18      | Approval rules, Security center, Activity audit                                                                                                        |
   | `content_creator`             | 13      | Approvals, Publishing, Analytics, Access governance, Approval rules, Incidents, Security center, Activity audit                                        |
   | `content_reviewer`            | 12      | Create content, Publishing, Unified inbox, Analytics, Access governance, Approval rules, Incidents, Security center, Activity audit                    |
   | `publisher`                   | 13      | Create content, Approvals, Analytics, Access governance, Approval rules, Incidents, Security center, Activity audit                                    |

   The full list of the 21: Dashboard, My work, Notifications, Create content, Content library, Approvals, Content calendar, Publishing, Unified inbox, Analytics & reports, Social accounts, Companies & brands, Publishing engine, Access governance, Roles & permissions, Approval rules, Incidents, Security center, Activity audit, My profile & access, Help & guides. A different number, or a hidden screen that opens when you type its address and shows data, is a finding. (A hidden screen must say in words that your role may not open it.)

5. Press **Ctrl K**. A search box opens. Type "inbox". Press Enter. You land on the inbox (if your role has it).

## T1. Signing in, staying signed in, signing out

(The real SSO parts: environment B.)

1. Open a page. Do nothing for 30 minutes (go and have tea). Click anything. **You must be sent to sign in.** You must not see old data on screen.
2. Sign in again (new ticket). You must come back to where you were or to the home screen, never to an error page.
3. Press **Sign out** in "My profile & access". Press the browser's Back button. **You must not see any signed-in page.**
4. **(B only)** Sign in with the SSO as a person who has **no role at all**. You must see a clear sentence ("you are signed in but have no DCC role yet"), not a blank page and not an error code.
5. Leave a tab open on the dashboard for 45 minutes. It must still sign you out (the little bell that checks every minute must not keep you alive).
6. Open the same ticket in two browsers. Sign out in one. The other must stop working at its next click.

## T2. The walls between companies (the most important test)

One company must never see another company's data.

1. Sign in as `company_admin` of `kerchanshe-coffee`. Open the content library and note the address of one post (the address shows `/content/<long id>`).
2. Sign in as `company_admin` of `kerchanshe-equipment`. Paste that address. **Expected: "not found" or "not allowed". Never the post.**
3. Repeat the same with: an account (`/social-accounts/<id>`), a company (`/companies/<id>`), a person (`/governance/<id>`), a publication (`/publishing/<id>`), an incident (`/incidents/<id>`).
4. Use the company switcher (if your role has more than one company). Pick company A, open a list, pick company B. **Nothing from A may stay on screen.**
5. The menu shows number badges on **Approvals, Incidents and Notifications** only. They must count only your company (and only what your role can act on).
6. Try the CSV export of a list. Open the file. It must hold only your company's rows.
7. As `group_admin` of the Group, everything of the Group is visible. As `auditor`, only what the role's scope allows, and **no button that changes anything anywhere**.

## T3. The life of one post (the main flow; everybody does it at least once, with different people)

You need three people: a **creator**, a **manager** (`company_marketing_manager` or `company_executive`) and a **publisher**, all in `kerchanshe-coffee`. A `content_reviewer` is a fourth person who may only comment. Use separate browsers. The working rules must be loaded (section A).

1. **Creator:** Create content. Write a post of 3 lines. Choose one account (a practice channel starts with `fake-` or is named "practice"). Look at the **preview**: one per network (Facebook, Instagram, LinkedIn, X, TikTok, YouTube). Type a very long text: the preview must warn you about the character limit of that network.
2. Add a **picture** (JPEG or PNG, a few MB). You must see a small thumbnail. Try a wrong file (a .exe, a .txt renamed to .jpg, a huge file). **It must be refused with a sentence you understand.**
3. Choose the **kind of content** (category: Routine, Ads and offers, Campaign, Crisis, ...). Press **Save draft**. Close the page. Open the content library. The draft is there. Open it. Your text, the picture and the account are still there.
4. **Edit** the draft (add a word). Save. Open the post's **Versions** tab. You see **two versions**, with who and when. The post page has the tabs Overview, Versions, Approval, Publications, Activity: open each.
5. **Send for review** (in the composer the button reads "Submit for review"). The state says "In review". The creator must **not** be able to approve their own post. Look at the Approval tab: a control you may not use is shown **disabled with the reason beside it** (or is absent). Try anyway: **it must be refused.**
6. **Reviewer:** My work lists the post. Open it. Write a comment "please change the date". A comment needs words. The creator gets a notification (look at the bell).
7. **Creator:** read the comment, edit (this makes version 3), send for review again.
8. **Manager:** open Approvals. The post shows its **time limit and the clock** (hours left). Approve it (a confirmation dialog appears). If the category needs **two different approvers**, approve with one person: the post must stay "waiting for another approval" (the dialog says how many approvals are still needed). Approve with a second, different person: now it is approved. A person who wrote any version, even one word, must **never** be able to approve, review or reject.
9. **New version after approval:** create a new version of an approved post (if the screen allows editing it; if not, write that it does not). The new version must **not** be publishable until it is approved again: an approval for one version does not carry over.
10. **Publisher:** Publishing. Publish the approved post now. State: "Published". Open its record: who asked, who approved, which version, the engine's id.
11. As publisher, try to publish a **draft**, a **rejected** post, a post approved for another account. All **must be refused**.
12. **Schedule** another approved post for 10 minutes later. It appears on the **Content calendar**. Press **Cancel the scheduled post**. State: cancelled. It disappears from "scheduled".
13. Use **Check with the engine** on the published post. The state must agree with the engine.
14. **Reject** a post as a manager. The comment is optional but helps: add one. The creator is notified and sees it. The post cannot be published. The creator can edit it and send it for review again; that starts a **new** request.
15. **Time limits:** open Approval rules and read each category's limit. Compare with [APPROVAL-AND-PUBLISHING-POLICY](../requirements/APPROVAL-AND-PUBLISHING-POLICY.md) section 2: Routine, Ads and offers, Partner mention, HR, Group announcement and the default 24 office hours; Campaign, Executive, Financial, Legal, Sensitive 48 office hours; Crisis 1 hour all day. Number of different approvers: 1 for Routine, Partner mention, HR and the default; **2** for Ads and offers, Campaign, Group announcement, Executive, Financial, Legal, Crisis, Sensitive. **Any difference is a finding.**
16. **Change the kind of content:** a reviewer or an approver may change the category of a post that is in review, only to a category that needs **at least as many approvals**, with a written reason of **at least 10 characters**. Try a stricter one (allowed, recorded, the request follows the new rule), a looser one (refused), and a 5-character reason (refused).
17. **Emergency approval:** only `group_marketing` and `company_executive` hold the permission. The button reads "Approve in an emergency". It needs a written reason of **at least 20 characters**. The post is flagged. A **different** person who holds the approve permission must then press "Confirm the emergency approval" (within 24 hours; a late confirmation is accepted and the management is told). Try: a 5-character reason (refused); the same person confirming (refused); a person who wrote any version confirming (refused); a role without the permission (no button, refused).
18. **7 days:** an approval is valid for 7 calendar days from the final approval, and a post cannot be scheduled beyond that. This cannot be waited out by hand. Read the approval: it must show until when it is valid. Hirko checks the lapse with the automatic tests.
19. **Timers:** reminders and escalations come from a timer inside the backend that runs about every **60 seconds**. After you make something happen, wait a minute before you say nothing happened.

## T4. Approval rules (the settings that decide who approves)

Only `group_admin` and `company_admin` have this screen. (Make a fresh ticket first: section A, point 2.)

1. Open **Approval rules**. You must see twelve categories and one **default** rule per company.
2. Change a rule (for example, "Routine" from 1 to 2 approvers). Save. Submit a new Routine post and check that **two** approvers are now needed. Put the rule back.
3. Try 0 approvers, a negative number, a time limit of 0 or over 720 hours, a text where a number is needed. **Each must be refused with a clear message.**
4. Try the same screen as a creator, a reviewer, a publisher, an executive, a manager: it must be **missing from the menu**, and typing `/approval-rules` must say your role may not open it.
5. A rule change must appear on the audit trail (T11).

## T5. Freezing publishing (the emergency brake)

1. As `company_admin` (or `group_admin`, `company_executive`, `group_cto`, `security_admin`), press **Freeze publishing** for the company, with a reason. Every attempt to publish for that company must now be refused ("frozen"). The screen must show the freeze clearly.
2. As the publisher, try to publish an approved post. **Refused.**
3. Freeze only **one account**. A post for another account of the same company must still go out.
4. **Scheduled before the freeze.** The owner decided that a freeze also holds scheduled posts. First schedule two approved posts for later (one on each of two accounts of the company), then freeze **one account**: the post of that account must be **cancelled** (status "cancelled", with the reason "Cancelled because publishing was frozen ..." on it, gone from the Content calendar, and not arriving at the practice network at its time); the post of the other account must stay scheduled. The people who may publish get a notification saying how many were cancelled. Freeze the **whole company**: every scheduled post of the company is cancelled, none of another company. After the lift nothing is scheduled again by itself; a person schedules the post again. If the engine cannot be reached when you freeze, the answer must say some posts could not be cancelled and they stay "scheduled": write what the screen says.
5. **Lift the freeze.** An ordinary freeze is lifted by the person with the right ("Lift the freeze"; make a fresh ticket first). A freeze that is **tied to a serious incident** (severity 1 or 2, "critical" or "high") needs **two people**: a **security** confirmation (`group_cto` or `security_admin`) and a **communications** confirmation (`group_marketing` or `company_executive`). After the first confirmation it must still be frozen; after the second it is lifted. A person can **withdraw** their own confirmation before the second arrives. One person must never be able to give both, and the ordinary lift button must refuse (409) for such a freeze.
6. **Post-incident review:** closing a severity-1 or severity-2 incident without a review must be refused. The review records the cause, impact, response, corrective actions, preventive measures, participants and when it was held. It is due five business days after the incident was first resolved.
7. Everything above appears on the audit trail.

## T6. The unified inbox (comments and messages)

Use the practice messages (fake engine, or the practice network in T14). The inbox is for roles with `inbox.read`: `company_admin`, `company_executive`, `company_marketing_manager`, `content_creator`, `publisher`, `group_marketing`.

1. As `company_marketing_manager`, open the inbox. You see messages with network, sender, time, priority and who it is assigned to. Open one: the conversation.
2. **Reply.** The reply shows as sent. Reload: it is still there.
3. **Priority and targets:** anyone who may reply can set a message to urgent, normal or low. Default targets: urgent 1 hour, normal 4 **working** hours (240 minutes), low 24 hours (1440 minutes). A company can set urgent to "round the clock" or to working time (an open question for the team). Working hours are Monday to Saturday 08:30 to 17:30, UTC+3, public holidays per company; they are changed by `inbox.manage` holders (`group_admin`, `company_admin`, `company_executive`, `company_marketing_manager`). Check the numbers on screen against these.
4. **Assign** a message to another person who may reply. They get a notification. **Re-assign** it: the clock does **not** restart. After the second re-assignment the manager is told once. Try to assign to a person who may not reply: **refused.**
5. **Escalation ladder** (percent of the target, in working time): 100%, the assignee and the Digital Marketing Manager are reminded; 150%, the message moves to the backup responder; 200%, the Marketing & Communications Manager is told and the miss is counted in the monthly "inbox misses" report. Testers read the overdue badge and the report; a developer can move time in the practice data.
6. **Responders:** the "Responders" part lets a company list primary and backup responders with their languages (everyone listed must be able to reply). Every message that was never assigned and not answered (last 7 days) is given by the timer to the primary responder of its language (Ethiopic letters mean Amharic) with the fewest open messages. **Claim** lets a responder take an unassigned message; if somebody already has it, it says so.
7. **Sensitive replies:** a reply about a legal threat, media, an investor, safety, personal data or a refund or compensation **must be held for approval** before it is sent. Write such a reply. It says it is waiting for approval. A **different** person who holds the approve permission (manager, executive, `group_marketing`) approves it; only then is it sent. The writer can never approve their own reply. Rejecting needs a written reason.
8. **Moderation:** hide, delete and block. **Hide**: the content creator ("content writer") and the company marketing manager. **Delete** and **block**: only the company marketing manager. Each needs a written reason of **at least 5 characters** (try 2: refused). A role that may not (publisher, reviewer, executive) must not be able to, and typing the address must be refused. Every action appears in the **moderation record** below the inbox, with who, when and why. Postiz has no moderation, so the record says the action was recorded only and the network was not changed.
9. **Automatic acknowledgement** ("we received your message", outside working hours): it has **no effect until a different person approves exactly that wording**. Test: write the text, try to approve it yourself (refused), approve it as another person, then make "now" outside working hours (change the working hours) and see a new message get it. It must **never** count as the first human response: the response clock keeps running.
10. Another company's messages never appear (T2).

## T7. Removing or correcting a post after it was published

Who may start it: a holder of `publication.remove` (`group_admin`, `group_marketing`, `company_admin`, `company_executive`, `company_marketing_manager`), **and** a role the post's category allows. With the working rules loaded the categories allow: Routine, Ads and offers, Partner mention and Campaign: the company marketing manager and the company administrator; Financial, Legal, HR and the default: the company executive and the company administrator; Group announcement, Executive, Crisis and Sensitive: the company executive, `group_marketing` and the company administrator. (`node scripts/run-with-env.mjs .env node scripts/demo/load-working-defaults.mjs --dry-run` prints the list.) So the manager cannot remove an HR post: that is correct, test it.

1. Open a **published** post and **remove** it. A **written reason of 10 to 1000 characters is required**: try 3 characters (refused) and 1001 characters (refused).
2. The state shows **removed**, with who, when and why. The record is never erased and a removed post cannot be published again or changed back. A publishing **freeze does not stop** a removal (freeze first, then remove: it must work). The audit trail has it.
3. If the engine cannot be reached (stop it), the removal must **fail visibly** and the post must still show as published, never as removed.
4. **Correct** a published post: it makes a **new draft** copying the published version, which goes through normal approval; you may choose to remove the original first. Check both ways.
5. A role without the permission (publisher, reviewer, creator) must not be able to, and a post that is not published cannot be removed.

## T8. Incidents and alerts

Incidents are for roles with `incident.read` (to read) and `incident.manage` (to change): `group_cto`, `security_admin` and `company_executive` change; `group_admin`, `group_marketing`, `company_admin` and `company_marketing_manager` read.

1. Open **Incidents**. Three tabs: Register, "Setup: categories, playbooks and contacts", and "Alerts: SMS, Teams and e-mail". Setup shows the **seven group-default categories** with their **playbooks** (steps) once the working rules are loaded. Recovery contacts are never preloaded (they are real people's details): add a fake one.
2. Open an incident of each severity. Add an update. The statuses move open, investigating, resolved, closed, and can be reopened. Everything is on the record.
3. Run **Check for posts DCC did not send** (the suspected-bypass check). With only practice channels it must say there is nothing to check; it must **not** say "all clean" if the engine could not be reached. Stop the engine and run it: it must say it **failed**, not "clean".
4. **Alerts:** the Alerts tab shows which channels (SMS, Teams, e-mail) are configured. With nothing configured each must say **"not configured"**, and a serious incident must **create nothing** to send. Nothing may say "sent". You may type a fake mobile number for yourself (never a real one); managers see others' numbers masked and their own in full; a test alert is limited to one per 30 seconds. The delivery list (outbox) is for `alert.manage` holders (`group_admin`, `group_cto`, `security_admin`).
5. A creator, reviewer or publisher must not see the incident screen at all.

## T9. People, roles and access

(Fresh ticket first: section A, point 2.)

1. As `group_admin`, open **Access governance**. Search a person, open them: their roles and companies.
2. **Give a role** to a person. Remove it. Both appear on the audit trail.
3. Give the **first role by email** to a person who has never signed in. It must work.
4. Try to **give yourself** a role (refused). Try to remove the **last Group administrator** (refused). Try as `company_admin` to give a group role (refused) or a role in another company (not found).
5. A person with several roles: in **My profile & access**, choose which role to work as, or "all together". Pick one: the menu and the buttons must change at once. You must not be able to pick a role you do not hold.
6. **Sign this person out everywhere** (`group_cto`, `security_admin`): the person's other browsers stop working at the next click. The person keeps their roles and can sign in again. The action asks for a recent sign-in and is on the audit trail.
7. Open **Roles & permissions**: the "Role by permission" table. Compare with [UAT-SCRIPTS](UAT-SCRIPTS.md): every "must" and "must not" line of every role. **Any disagreement between the table and what the role can really do is a finding.**
8. Names: people the viewer may not list show as "Person" plus a code (a known gap). Note each place you see it.

## T10. The registry: companies, brands, social accounts

1. As `group_admin`, create a **company** and a **brand** with an ordinary name, then with Amharic letters (ኬርቻንሼ), then with emoji, then a very long name (200 letters), then one with `<b>bold</b>` and `"quotes"`. Each must be saved and shown **exactly as typed** (no bold, no cut-off, no crash) or refused with a clear sentence.
2. **Rename, suspend, archive, re-activate** the company. Write what happens to its accounts and posts while it is suspended or archived.
3. **Register a social account** with an owner and a **backup administrator**. The backup picker must **not offer the owner**. Change the account's status (set it to archived: publishing to it must be refused). Link it to an engine channel.
4. Open the **account page**. Tabs: Profile, Assignments, Engine link, Publications, Incidents, Analytics. Open each. "This account has gaps in the register" lists each gap with a "Fix it" link to the right tab.
5. Open the **company page**. Tabs: Overview, Brands, Accounts, People, Rules, Publishing, Inbox, Incidents. Each tab must show real data, or a sentence that says it is empty. **A blank area is a finding.**

## T11. Activity audit and Security center

1. After doing T3 to T9, open **Activity audit** as `group_cto` (or `security_admin`, `auditor`). **Every step you did must be there**: who, when, what, which company, and for a post which version.
2. Use the filters (who, action, company, date). Open one event in the side panel. The details must make sense to a non-technical reader.
3. Press **Check the record**. It must say the chain is intact ("The chain is broken" is the bad answer). (Never change the database by hand on a shared machine to see what happens; Dawit and Hirko test that with the attack tests.)
4. **Export** the audit trail (needs a recent sign-in). Open the file: only your scope, no passwords, no tokens.
5. As `company_admin` (no audit permission): the screen must be missing from the menu and refused when typed.
6. Open **Security center** (`group_cto`, `security_admin`). Every line is either a number the system really knows, or "not monitored" in words. A green tick for something nobody measures is a finding.

## T12. Dashboard, My work, Notifications, Analytics

1. **Dashboard** as each role: only the tiles that role may see. Numbers must match the lists behind them (click a tile; count the rows).
2. **My work** as each role: it shows what waits for **that** role. When empty it says "Nothing is waiting for you right now". Do something that creates work (send a post for review): the right person's My work changes, nobody else's.
3. **Notifications:** filter by state, kind and company; search; mark one read; **Mark all as read** (the bell count drops to 0 and stays 0 after reload). Open a notification: you land on the thing it is about.
4. **Analytics** (roles with `report.read`): each network shows its own labels and numbers, **never added together**, and "no data" must never be shown as a zero.

## T13. Every screen: how it behaves (Rahel and everyone with a second device)

Do these on **each** screen your role has, as at least two roles.

1. **Every table:** type in the search; filter; sort by clicking a heading twice; hide and show a column; go to the next page; **Export CSV** and open it (the file must hold what is on screen). Click a row: it opens on its own page, and the address changes to `/<screen>/<id>`. Press Back: you return to the list with the same search. Reload on a page with a tab: the **same tab** opens (`?tab=` in the address).
2. **Empty, loading and failing:** a screen with no data says so in words. Stop the backend and reload: the page must say something went wrong in words, not stay white (where the server answered, it shows a request id). Start the backend: it recovers on reload.
3. **Phone width (360 px):** in the browser's developer tools choose a phone, or squeeze the window. **The page must never scroll sideways.** A wide table scrolls by itself. The menu opens and closes.
4. **Dark theme and light theme:** switch. Text is readable on every screen, nothing white-on-white, nothing invisible.
5. **Keyboard only:** put the mouse away. Press Tab: you must always see where you are (a visible outline). Reach every button, open and close every dialog with Esc, and never get stuck. **Ctrl K** works.
6. **Zoom to 200%:** nothing is cut off.
7. **A screen reader** (NVDA on Windows is free): every button says what it does (not "button 4"), the tables have headings, dialogs announce themselves.
8. **Browsers:** Chrome, Edge, Firefox, and Safari or a phone. Repeat T3 in each. Any difference is a finding.
9. **Words:** every sentence must be understandable to a marketing person who has never seen the system. Write down each sentence that is not (a code, a technical word, a sentence that blames the user).
10. By machine (developers): `node scripts/verify/screens-pass.mjs` (its first lines say what it needs: Playwright and axe-core installed outside the repository, and one practice person per role).

## T14. The posting engine (Postiz) and the practice network (Woluman, and anyone with Docker)

The practice network exists **only in the image built from our fork** (`DawitBK/postiz-app`, branch `feat/dawit/practice-network`), not in the normal Postiz. Follow [PRACTICE-NETWORK](../engine/PRACTICE-NETWORK.md) "Start it" exactly (build the image, set `POSTIZ_IMAGE`, `POSTIZ_VERSION` and `POSTIZ_PRACTICE_NETWORK=true` in `operational-engine/postiz.env`, start with `--profile practice`, set `ENGINE_PROVIDER=postiz`, `DCC_ENGINE_ALLOW_UNVERIFIED=true`, `DCC_ENGINE_PRACTICE_NETWORK_PLATFORM=linkedin` and, for the inbox, `DCC_ENGINE_POSTIZ_INBOX=true` in `.env`). Every step that does not work as written is a finding about the document. The pretend network shows every post at `http://localhost:4100/`.

1. Open Postiz. **Add Channel**: "Practice network" is in the list. Type a handle, press Connect. The channel appears in Postiz **and** in DCC's "Publishing engine" screen. Register a DCC social account for the company as a LinkedIn account and link it to the channel.
2. Publish a post through DCC to it: it arrives at `http://localhost:4100/`. Schedule one: it arrives at the time. Cancel one: it does not arrive. A post that has a **picture**: the picture arrives (this has not been run live before).
3. Reply to a practice message through the DCC inbox: it arrives at the practice network.
4. **Stop the engine** while a publish is running. DCC must **not** retry blindly and must **not** claim success: the state is "unknown" or "pending", and the stuck send can be settled by hand (Publishing screen, unsettled sends) with a written reason, after you start the engine again.
5. Make a post **directly in Postiz** (not through DCC) and run "Check for posts DCC did not send": DCC raises an incident for it.
6. Run both proof scripts yourself. They need: the practice people (`qa.<role>@example.test`, see the header of `scripts/verify/screens-pass.mjs`), the channel's id, and your own ports and company: `POSTIZ_VERIFY_CHANNEL_ID=<id> COMPANY_SLUG=<a company slug> API=http://localhost:<api port> WEB_ORIGIN=http://localhost:<web port> node scripts/verify/practice-network-e2e.mjs` and `POSTIZ_VERIFY_CHANNEL_ID=<id> npm run verify:live -w @dcc/engine-client`. All checks must pass (on 2026-11-27: 16 of 16 and 6 of 6). A check that fails is a finding even if everything looked fine by eye.
7. Real networks (Facebook, Instagram, LinkedIn, YouTube, TikTok, X): **not testable until a developer app exists.** Do not say it works.

## T15. Try to break it (everybody; spend at least an hour)

Do these on screens where you can type or click.

1. Type `<script>alert(1)</script>` into every text box (post, comment, company name, reason). It must show as plain text and never run.
2. Type `' OR 1=1 --` into every search box. Nothing strange may happen.
3. Paste a 100 000-letter text. The page must stay usable and say the limit.
4. **Double-click** every "Send for review", "Approve", "Publish". It must happen **once**, never twice (a double publish is a serious finding).
5. Press **Back** after publishing, after approving, after signing out. Reload in the middle of a form. Open the same post in two browsers and change it in both. The second save must warn or refuse, not silently overwrite.
6. Change the **id in the address** by one letter. The answer must be a clear "not found".
7. Change the **time zone** of your computer to another country, and make a scheduled post near midnight. DCC works in the company's time (UTC+3, East Africa Time). The time on screen must be the same for everybody.
8. Switch the network off in the middle of a save. The screen must say it failed; the data must not be half saved.
9. Open the app after 30 minutes of idle with a form half-filled. Your text must not appear on the sign-in page.
10. Try everything a role "must not" do from [UAT-SCRIPTS](UAT-SCRIPTS.md) by **typing the address directly**, not only by looking for a button.

## T16. Whole story, 30 minutes (the acceptance demo)

Do the nine steps of "One scenario for everyone together" at the end of [UAT-SCRIPTS](UAT-SCRIPTS.md), as nine different people, without any help. **It must run from 1 to 9.** Time it and write down every place where you hesitated: each hesitation is a usability finding.

---

## Severity (so the list can be sorted)

| Level        | Meaning                                                                                                           | Example                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Critical** | Data of one company visible to another; a post goes out that was not approved; a way around a freeze or the audit | creator approves own post; B sees A's post        |
| **High**     | A role can do what it must not, or cannot do what it must; data lost; a double publish; a crash on a main screen  | publisher can edit; a saved post is gone          |
| **Medium**   | Wrong number or label, a screen thin or blank, a message nobody understands, something broken at phone width      | tab shows nothing; a "0" that should be "no data" |
| **Low**      | Spelling, spacing, a colour, a small inconsistency                                                                | button says "Sumbit"                              |

## Finding template (copy one per problem)

```
Title: (one line: what is wrong)
Screen / address:
Role (and company):
Browser and size (for example Chrome, desktop; or phone 360 px):
Steps (numbered, so that someone else can repeat them):
What I expected:
What I saw:
Request id (shown in the error box, if any):
Screenshot: yes/no (practice data only)
Severity (Critical / High / Medium / Low):
Test number (for example T3 step 9):
```

If you use GitHub: open an issue, put the title as `[test] ...` and paste the template. If you do not use GitHub: send it to Dawit in a message or a document; he files it.

## When you finish a part

Send Dawit: the filled sheet, the findings, and **two lines**: what you did **not** manage to test and why, and the one thing that worried you most. Dawit answers each finding with fixed, not a bug (with the reason), or later (with the date).

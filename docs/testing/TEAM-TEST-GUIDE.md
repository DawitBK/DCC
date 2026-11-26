# Team test guide: try to break DCC (round 1, from 2026-11-27)

Owner: Dawit. Written in plain words for everybody on the team, developers and non-developers. **No programming is needed to run most of it.**

**Why this exists.** Since 2026-11-25 Dawit rebuilt the screens and finished most of the backend himself. Code that its own author tests passes too easily. Now people who did not write it must use it the way real staff will, and the way a careless or a bad person might. **Your job is to find what is wrong. A test where you found nothing, after a hard try, is good. A test you did not really do is worse than no test.**

## Rules for every test

1. **Practice data only.** Companies, people, posts and channels are fake. Never type a real password, a real phone number, a real person's data or a real social account. Never put a screenshot with real data in GitHub.
2. **Write what you saw, not what you expected.** "Pass" only if you saw it yourself. If you are not sure, it is not a pass.
3. **One finding, one note.** Use the template at the end. A finding without the steps to repeat it cannot be fixed.
4. **Do not fix other people's findings quietly.** Report first. Dawit owns every area now, and anyone may send a fix as a pull request, but a finding must exist on the list first.
5. **Try the "must not" half as hard as the "must" half.** A role that can do too much is a failure, the same as a role that cannot do enough.
6. **Never merge your own pull request.** Dawit merges.

## How to start (two ways to sign in)

### A. Without the company SSO (on your own laptop, all roles) - this is how most of you test

Follow [05-RUN-EVERYTHING-ON-YOUR-LAPTOP](../team/05-RUN-EVERYTHING-ON-YOUR-LAPTOP.md) from the top: `git pull` on `develop`, `npm install`, `npm run build:packages`, `npm run db:migrate`, start the backend and the web app, load the sample data, then make a sign-in ticket for a role:

```
npm run dev:session -- creator@example.test content_creator kerchanshe-coffee
```

Paste the long line into the browser as the cookie `dcc_sid` (steps are in section 05). The ticket works for 8 hours but stops after **30 minutes of not using it**. If a page suddenly asks you to sign in, make a new ticket. That is correct behaviour, and also a test (T1).

Make one ticket per role you need and keep them in a plain text note on your own laptop (not in GitHub). Use **a different browser or a private window per person**, so you can be three people at once. The 11 roles:

| Level   | Roles                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| Group   | `group_admin`, `group_cto`, `security_admin`, `group_marketing`                                                       |
| Company | `company_admin`, `company_executive`, `company_marketing_manager`, `content_creator`, `content_reviewer`, `publisher` |
| Either  | `auditor`                                                                                                             |

The three sample companies are `kerchanshe-coffee`, `kerchanshe-equipment` and `buna-pen-and-plate`.

The posting engine (Postiz) is optional. Without it DCC uses a fake engine: everything works and nothing leaves your laptop. Woluman and anyone testing T14 starts the real engine, section 05 part 4.

### B. With the company SSO (the real sign-in) - only on the test environment

The real sign-in (password and authenticator code, and the "sign in again" step) exists only on the test environment (the "mirror"), which runs on Dawit's PC. You cannot start it on your laptop. Ask Dawit for the address and for a test person's sign-in. **Never share it, never write it in GitHub.** Test T1 and the sign-in-again checks of T9 there when Dawit opens it for you. Everything else is the same as in A.

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
4. Count the menu entries as `group_admin`: Overview (Dashboard, My work, Notifications), Content (Create content, Content library, Approvals, Content calendar, Publishing, Unified inbox), Insight (Analytics & reports), Registry (Social accounts, Companies & brands, Publishing engine), Governance (Access governance, Roles & permissions, Approval rules, Incidents), Security (Security center, Activity audit), Account (My profile & access, Help & guides). That is **21 screens**. If one is missing for the all-powerful role, that is a finding.
5. Press **Ctrl K**. A search box opens. Type "inbox". Press Enter. You land on the inbox.

## T1. Signing in, staying signed in, signing out

(Sign-in-again with the real SSO: environment B.)

1. Open a page. Do nothing for 30 minutes (go and have tea). Click anything. **You must be sent to sign in.** You must not see old data on screen.
2. Sign in again. You must come back to where you were or to the home screen, never to an error page.
3. Press **Sign out** in "My profile & access". Press the browser's Back button. **You must not see any signed-in page.**
4. Sign in as someone with **no role at all** (make a ticket for a new email with no role: the app says you are signed in but have no DCC role). You must see a clear sentence, not a blank page and not an error code.
5. Leave a tab open on the dashboard for 45 minutes. It must still sign you out (the little bell that checks every minute must not keep you alive).
6. Open the same ticket in two browsers. Sign out in one. The other must stop working at its next click.

## T2. The walls between companies (the most important test)

One company must never see another company's data.

1. Sign in as `company_admin` of `kerchanshe-coffee`. Open the content library and note the address of one post (the address shows `/content/<long id>`).
2. Sign in as `company_admin` of `kerchanshe-equipment`. Paste that address. **Expected: "not found" or "not allowed". Never the post.**
3. Repeat the same with: an account (`/social-accounts/<id>`), a company (`/companies/<id>`), a person (`/governance/<id>`), a publication (`/publishing/<id>`), an incident (`/incidents/<id>`).
4. Use the company switcher (if your role has more than one company). Pick company A, open a list, pick company B. **Nothing from A may stay on screen.**
5. In every list, as a company role, look at the counts in the menu (Approvals, Inbox, Notifications, My work). They must count only your company.
6. Try the CSV export of a list. Open the file. It must hold only your company's rows.
7. As `group_admin` of the Group, everything of the Group is visible. As `auditor`, only what the role's scope allows, and **no buttons that change anything anywhere**.

## T3. The life of one post (the main flow; everybody does it at least once, with different people)

You need three people: a **creator**, a **reviewer** (and/or manager) and a **publisher**, all in `kerchanshe-coffee`. Use three browsers.

1. **Creator:** Create content. Write a post of 3 lines. Choose one account (a practice channel starts with `fake-` or is named "practice"). Look at the **preview**: one per network (Facebook, Instagram, LinkedIn, X, TikTok, YouTube). Type a very long text: the preview must warn you about the character limit of that network.
2. Add a **picture** (JPEG or PNG, under a few MB). You must see a small thumbnail. Try a wrong file (a .exe, a .txt renamed to .jpg, a huge file). **It must be refused with a sentence you understand.**
3. Choose a **category** (Routine, Ads and offers, Campaign, Crisis, ...). Save as draft. Close the page. Open the content library. The draft is there. Open it. All your text, the picture and the account are still there.
4. **Edit** the draft (add a word). Save. Open the "Versions" tab. You see **two versions**, with who and when.
5. **Submit for review.** The state says "In review". The creator must **not** be able to approve their own post: try, **it must be refused** (the button is absent or the answer is "refused").
6. **Reviewer:** open My work. The post is listed. Open it. Write a comment "please change the date". The creator gets a notification (look at the bell).
7. **Creator:** read the comment, edit (this makes version 3), submit again.
8. **Manager / executive:** open Approvals. The post shows its **time limit** and the clock. Approve it. If the category needs **two different approvers**, approve with one person: the post must stay "waiting for a second approval". Approve with a second, different person: now it is approved. A person who wrote any version, even one word, must **never** be able to approve.
9. Try to approve **version 2** after version 3 exists. It must say the approval is for another version.
10. **Publisher:** Publishing. Publish the approved post now. State: "Published". Open its record: it shows who asked, who approved, which version, the engine's id.
11. As publisher, try to publish a **draft**, a **rejected** post, a post approved for another account. All **must be refused**.
12. **Schedule** another approved post for 10 minutes later. It appears on the **Content calendar**. Cancel it. State: cancelled. It disappears from "scheduled".
13. Use **Check with the engine** on the published post. The state must agree with the engine.
14. **Reject** a post as a manager (with a reason). The creator is notified and sees the reason. The post cannot be published.
15. Look at the **time limits** (Round 2): the Approvals list shows how much time is left. In the practice data, use the Approval rules screen to read each category's limit. Compare with [APPROVAL-AND-PUBLISHING-POLICY](../requirements/APPROVAL-AND-PUBLISHING-POLICY.md) section 2. **Any number that differs is a finding.**
16. **Category change:** a reviewer or manager may move a post to a **stricter** category. Try moving to a stricter one (allowed, and recorded) and to a looser one (must be refused).
17. **Emergency approval:** the one senior role that holds the permission (the Roles & permissions screen says who) can approve alone with a written reason of at least 20 characters. The post is flagged "emergency", and a **different** person must confirm afterwards. Try: reason of 5 characters (refused); the same person confirming (refused); a person who wrote the post confirming (refused).
18. The 7-day rule (an approval lapses after 7 days) cannot be tested by hand. Read the approval's page: it must **show the date until which the approval is valid**. Hirko tests the lapse with the automatic tests.

## T4. Approval rules (the settings that decide who approves)

1. As `group_admin` or `company_admin`, open **Approval rules**. You must see twelve categories and one **default** rule per company.
2. Change a rule (for example, "Routine" from 1 to 2 approvers). The screen asks you to **sign in again** if your sign-in is older than 15 minutes (environment B). After you save, submit a new Routine post and check that **two** approvers are now needed. Put the rule back.
3. Try to set 0 approvers, a negative number, a time limit of 0, a text where a number is needed. **Each must be refused with a clear message.**
4. Try the same screen as a creator, a reviewer, a publisher: it must be **read-only or hidden**, and a direct address must be refused.
5. A rule change must appear on the audit trail (T11).

## T5. Freezing publishing (the emergency brake)

1. As `company_admin`, **freeze publishing** for the company, with a reason. Every publish button for that company must now be refused ("frozen"), including **scheduled** posts that are due. The dashboard or Publishing screen must show the freeze clearly.
2. As the publisher, try to publish an approved post. **Refused.**
3. Freeze only **one account**. A post for another account of the same company must still go out.
4. **Lift the freeze.** An ordinary freeze is lifted by the person with the right (asks you to sign in again). A freeze that is **tied to a serious incident** (severity 1 or 2) needs **two people**: one from security (CTO or security administrator) and one from communications. Open such a freeze: after the first confirmation it must still be frozen; after the second it is lifted. A person can **withdraw** their own confirmation before the second arrives. One person must never be able to give both.
5. After a serious incident, a **post-incident review** is written. Open it: it must list what happened, what was done and who closed it. You cannot close the incident without it (check this).
6. Everything above appears on the audit trail.

## T6. The unified inbox (comments and messages)

Use the practice network (messages start as practice messages).

1. As `company_marketing_manager`, open the inbox. You see messages with network, sender, time, priority and who it is assigned to. Open one: the conversation.
2. **Reply.** The reply shows as sent. Reload: it is still there.
3. **Priority and clock:** an urgent message shows a target of 1 hour, a normal one 4 **working** hours, a low one 24 hours (working hours: Monday to Saturday 08:30 to 17:30, per company, Working hours setting). Check the numbers on screen against these. Open Working hours and read it.
4. **Assign** a message to another person who may reply. They get a notification. **Re-assign** it: the clock does not restart. After two re-assignments the manager gets it. Try to assign to a person who may not reply: **refused**.
5. **Overdue:** the overdue badge appears when the target passes. (A developer can make time pass in the practice data; a tester reads the badge and the "inbox misses" report.)
6. **Automatic assignment:** the "Responders" part lets a company list responders per language. Make a message in each language of the sample data and check it goes to the right responder, and that **Claim** lets another responder take it.
7. **Sensitive replies:** a reply to a message about a legal threat, media, investors, safety, personal data, refund or compensation **must be held for approval** before it is sent. Write such a reply. It must say "waiting for approval". A second, different, allowed person approves. Only then it is sent. The author cannot approve their own reply.
8. **Moderation:** hide, delete and block. Try each. **Hide** is allowed to the content creator (the "content writer") and the company marketing manager. **Delete** and **block** only to the company marketing manager (the "Digital Marketing Manager"). Each needs a written reason of at least 5 characters: try with 2 characters (refused). A role that may not (publisher, reviewer, executive) must not see the button, and typing the address must be refused. Every action appears in the **moderation record** below the inbox, with who, when and why. Moderation is recorded only against Postiz: check that the screen says so.
9. **Automatic acknowledgement:** outside working hours (change the company's working hours to make "now" outside), a new message gets the approved automatic "we received your message". It must **never** count as the first human response.
10. Another company's messages never appear (T2).

## T7. Removing a post after it was published

1. As the company marketing manager (the role that holds the permission), open a **published** post and **remove** it. A **written reason of 10 to 1000 characters is required**: try 3 characters (refused) and 1001 characters (refused).
2. The post's state shows **removed**, with who, when and why. The record is never erased. A publishing **freeze does not stop** a removal (freeze first, then remove: it must work). The audit trail has it.
3. If the engine cannot be reached (stop it) the removal must **fail visibly** and the post must still show as published, never as removed.
4. A role without the permission (publisher, reviewer, creator) must not see the button and the address must be refused. A post that is not published cannot be "removed".

## T8. Incidents and alerts

1. As `company_executive` or `group_cto`, open **Incidents**. You see **categories** (seven group defaults), their **playbooks** (steps) and **recovery contacts** (roles to call).
2. Open an incident of each severity. Add an update. Resolve it. A resolved incident cannot be edited quietly.
3. Run **Check for posts DCC did not send** (the suspected-bypass check). With only practice channels it must say there is nothing to check; it must **not** say "all clean" if the engine could not be reached. Stop the engine and run it: it must say it **failed**, not "clean".
4. **Alerts (SMS, Teams, e-mail):** the settings screen shows who is alerted for serious incidents. **Nothing is sent** until IT gives the real webhook, gateway and mobile numbers. Check that the page says so in words, and that the outbox shows queued messages as "not sent" rather than "sent".
5. A creator, reviewer or publisher must not see the incident screen's change buttons.

## T9. People, roles and access

1. As `group_admin`, open **Access governance**. Search a person, open them: roles, scope, when they last signed in.
2. **Give a role** to a person. The screen asks you to sign in again if the sign-in is older than 15 minutes (B). Remove it. Both appear on the audit trail.
3. Give the **first role by email** to a person who has never signed in. It must work.
4. Try to **give yourself** a role (refused). Try to remove the **last Group administrator** (refused). Try as `company_admin` to give a group role (refused) or a role in another company (not found).
5. A person with several roles: in **My profile & access**, choose which role to work as, or "all together". Pick one: the menu and the buttons must change at once. You must not be able to pick a role you do not hold.
6. **Sign this person out everywhere** (security roles): the person's other browsers stop working at the next click. The person keeps their roles and can sign in again. The action asks for a recent sign-in and is on the audit trail.
7. Open **Roles & permissions**: the "Role by permission" table. Compare with [UAT-SCRIPTS](UAT-SCRIPTS.md): every "must" and "must not" line of every role. **Any disagreement between the table and what the role can really do is a finding.**
8. Names: people the viewer may not list can show as "Person 4b5e7da0". That is a known gap (Rahel and Hirko are fixing it). Note each place you see it.

## T10. The registry: companies, brands, social accounts

1. As `group_admin`, create a **company** and a **brand** with an ordinary name, then with Amharic letters (ኬርቻንሼ), then with emoji, then a very long name (200 letters), then one with `<b>bold</b>` and `"quotes"`. Each must be saved and shown **exactly as typed** (no bold, no cut-off, no crash) or refused with a clear sentence.
2. **Rename, suspend, archive, re-activate** the company. An archived company's accounts cannot publish.
3. Register a **social account** with an owner and a **backup administrator** (a different person). Try the same person for both (the screen must refuse or warn). Change its status. Link it to an engine channel.
4. Open the **account page**: tabs, who is assigned, recent posts, status history.
5. Open the **company page**: tabs for brands, accounts, people, rules, freezes, incidents. Each tab must show real data, or a sentence that says it is empty. **A blank area is a finding.**

## T11. Activity audit and Security center

1. After doing T3 to T9, open **Activity audit** as `group_cto` (or `security_admin`, `auditor`). **Every step you did must be there**: who, when, what, which company, and for a post which version.
2. Use the filters (who, action, company, date). Open one event in the side panel. The details must make sense to a non-technical reader.
3. **Verify the chain.** It must say the notebook is intact. (Never try to change the database to see what happens on a shared machine; Dawit and Hirko test that with the attack tests.)
4. **Export** the audit trail (asks for a recent sign-in, B). Open the file: only your scope, no passwords, no tokens.
5. As `company_admin` (no audit permission): the screen must be hidden or refused.
6. Open **Security center**. Every line is either a number the system really knows, or "not monitored" in words. A green tick for something nobody measures is a finding.

## T12. Dashboard, My work, Notifications, Analytics

1. **Dashboard** as each role: only the tiles that role may see. Numbers must match the lists behind them (click a tile; count the rows).
2. **My work** as each role: it shows what waits for **that** role. When empty it says "Nothing is waiting for you right now". Do something that creates work (submit a post): the right person's My work changes, nobody else's.
3. **Notifications:** filter by state, kind and company; search; mark one read; mark all read (the bell count drops to 0 and stays 0 after reload). Open a notification: you land on the thing it is about.
4. **Analytics:** each network shows its own labels and numbers, **never added together**, and "no data" must never be shown as a zero.

## T13. Every screen: how it behaves (Rahel and everyone with a second device)

Do these on **each** screen, as at least two roles.

1. **Every table:** type in the search; filter; sort by clicking a heading twice; hide and show a column; go to the next page; **Export CSV** and open it (the file must hold what is on screen). Click a row: it opens on its own page, and the address changes to `/<screen>/<id>`. Press Back: you return to the list with the same search. Reload on a page with a tab: the **same tab** opens (`?tab=` in the address).
2. **Empty, loading and failing:** a screen with no data says so in words. Stop the backend and reload: the page says something went wrong **and shows a request id**, not a white page. Start the backend: it recovers on reload.
3. **Phone width (360 px):** in the browser's developer tools choose a phone, or squeeze the window. **The page must never scroll sideways.** A wide table scrolls by itself. The menu opens and closes.
4. **Dark theme and light theme:** switch. Text is readable on every screen, nothing white-on-white, nothing invisible.
5. **Keyboard only:** put the mouse away. Press Tab: you must always see where you are (a visible outline). Reach every button, open and close every dialog with Esc, and never get stuck. **Ctrl K** works.
6. **Zoom to 200%:** nothing is cut off.
7. **A screen reader** (NVDA on Windows is free): every button says what it does (not "button 4"), the tables have headings, dialogs announce themselves.
8. **Browsers:** Chrome, Edge, Firefox, and Safari or a phone. Repeat T3 in each. Any difference is a finding.
9. **Words:** every sentence must be understandable to a marketing person who has never seen the system. Write down each sentence that is not (a code, a technical word, a sentence that blames the user).

## T14. The posting engine (Postiz) and the practice network (Woluman, and anyone with Docker)

1. Start the engine (section 05 part 4) with the practice network on. Open Postiz. **Add Channel**: "Practice network" is in the list. Type a handle, press Connect. The channel appears in Postiz **and** in DCC's "Publishing engine" screen. Link it to a DCC account.
2. Publish a post through DCC to it: it arrives. Schedule one: it arrives at the time. Cancel one: it does not arrive. A post that has a **picture**: the picture arrives.
3. Reply to a practice message through the DCC inbox: it arrives at the practice network.
4. **Stop the engine** while a publish is running. DCC must **not** retry blindly and must **not** claim success: the state is "unknown", and the stuck key can be settled by hand later (Publishing, unsettled sends) with a reason.
5. Make a post **directly in Postiz** (not through DCC) and run the bypass check: DCC raises an incident for it.
6. Run `node scripts/verify/practice-network-e2e.mjs` and `npm run verify:live -w @dcc/engine-client` (their headers say what they need): all checks must pass. A check that fails is a finding even if everything looked fine by eye.
7. Real networks (Facebook, Instagram, LinkedIn, YouTube, TikTok, X): **not testable until a developer app exists.** Do not say it works.

## T15. Try to break it (everybody; spend at least an hour)

Do these on screens where you can type or click.

1. Type `<script>alert(1)</script>` into every text box (post, comment, company name, reason). It must show as plain text and never run.
2. Type `' OR 1=1 --` into every search box. Nothing strange may happen.
3. Paste a 100 000-letter text. The page must stay usable and say the limit.
4. **Double-click** every "Submit", "Approve", "Publish". It must happen **once**, never twice (a double publish is a serious finding).
5. Press **Back** after publishing, after approving, after signing out. Reload in the middle of a form. Open the same post in two browsers and change it in both. The second save must warn or refuse, not silently overwrite.
6. Change the **id in the address** by one letter. The answer must be a clear "not found".
7. Change the **time zone** of your computer to another country, and make a scheduled post near midnight. DCC works in the company's time (East Africa Time). The time on screen must be the same for everybody.
8. Switch the network off in the middle of a save. The screen must say it failed; the data must not be half saved.
9. Open the app after 30 minutes of idle with a form half-filled. Your text must not appear on the sign-in page.
10. Try everything a role "must not" do from [UAT-SCRIPTS](UAT-SCRIPTS.md) by **typing the address directly**, not only by looking for a button.

## T16. Whole story, 30 minutes (the acceptance demo)

Do the nine steps of "One scenario for everyone together" at the end of [UAT-SCRIPTS](UAT-SCRIPTS.md), as nine different people, without any help. **It must run from 1 to 9.** Time it and write down every place where you hesitated: each hesitation is a usability finding.

---

## Severity (so the list can be sorted)

| Level        | Meaning                                                                                                          | Example                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Critical** | Data of one company visible to another; a post goes out that was not approved; a way around freeze or the audit  | creator approves own post; B sees A's post        |
| **High**     | A role can do what it must not, or cannot do what it must; data lost; a double publish; a crash on a main screen | publisher can edit; a saved post is gone          |
| **Medium**   | Wrong number or label, a screen thin or blank, a message nobody understands, something broken at phone width     | tab shows nothing; a "0" that should be "no data" |
| **Low**      | Spelling, spacing, a colour, a small inconsistency                                                               | button says "Sumbit"                              |

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

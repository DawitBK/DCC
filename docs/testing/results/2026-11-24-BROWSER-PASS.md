# Record: browser pass of every role and the main write flows, 2026-11-24 (R-09)

Run by the lead's engineering assistant in a real browser (Microsoft Edge driven by Playwright, installed outside the repository),
against the real backend and the development database. This is the first pass of backlog item R-09. It is **partial**: the list under
"What this pass did not cover" is as important as the results.

## Setup

| Part      | What ran                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser   | Microsoft Edge (Chromium), headless, driven by Playwright 1.65. Light and dark theme chosen through the page's own theme storage                                                                                                      |
| Web app   | the production build (`next build`, `next start`) so the real nonce-based CSP was enforced; the code of `develop` plus the three open pull requests of this work (settle a stuck send, inbox assignment, zod eval) for the first runs |
| API       | the development backend (`ENGINE_PROVIDER=fake`: the in-memory practice engine, so **nothing was sent to a network and no Postiz write path was used**), the development database `dcc_dev` after `npm run db:migrate`                |
| Sign-in   | `npm run dev:session` (a practice user and session in the development database). The SSO was not involved                                                                                                                             |
| People    | one practice user per role, all with `@example.test` addresses, in the company Kerchanshe Coffee (group roles with no company)                                                                                                        |
| Viewports | 1280 x 900 and 360 x 740                                                                                                                                                                                                              |
| Automated | on every page load: horizontal scroll, console errors and warnings, failed requests, `securitypolicyviolation` events, and axe-core 4 with the WCAG 2.0, 2.1 and 2.2 level A and AA rules (colour contrast included)                  |

## What was covered

1. **Every screen as every role.** 11 roles x 14 screen addresses x 2 viewports x 2 themes = 616 page loads per run (the roles are the
   11 in `portal/contracts/src/roles.ts`; the 14 addresses are the workspace routes). A screen a role may not open shows the "not
   available for your role" page, and that page was checked too. Five full runs were made while fixing (see the table below).
2. **Signed-out and error pages**: the sign-in page, the 404 page signed out and signed in, and the role chooser (a person with two roles),
   at both viewports and both themes (16 loads per run).
3. **Keyboard**: about 77 Tab presses on each of the publishing, inbox, create-content, approvals and dashboard screens (focus always moved on,
   no trap, every focused control had a visible focus style); the publish dialog (focus stays inside for 14 Tabs, Escape closes it,
   focus returns to the button that opened it); the phone menu (opens, closes with Escape, closes after choosing a screen, and is not
   reachable by Tab while closed).
4. **Write flows against the real API** (practice engine), 1280 px and, for the first chain, also 360 px:
   - `content_creator`: save a draft (an empty form shows errors, no account chosen shows an error), save, submit for review;
   - `content_reviewer`: add a review comment (an empty comment is refused); `company_executive`: approve (the reviewer role has no Approve button, correctly);
   - `publisher`: publish now to one account; schedule a second post three hours ahead and cancel the schedule; "Check with the engine" (2 still waiting);
   - `company_admin`: freeze publishing for the company with a reason, then lift it;
   - inbox: assign, reassign, "assign to me", clear; the filters; a reply that records the first-response time; per-company response target set to 60 minutes (six practice messages became Overdue) and cleared (pull request 88);
   - incident setup: categories with a playbook, a recovery contact, an incident filed with a category (pull request 93).
   - settle a stuck send: the 404 answer of the real API was shown in the dialog; the success paths were exercised **against mocked answers only** (no stuck key exists in the development data; pull request 86).

## Results

| Run                                   | Page loads | Pages with at least one axe violation | Violation types                                                                                                                |
| ------------------------------------- | ---------: | ------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------ |
| 1, before any fix                     |        616 |                                   616 | colour contrast (616 pages), scroll region not keyboard-reachable (90), accessible name does not contain the visible text (12) |
| 2, after the first round of fixes     |        560 |                                   332 | colour contrast only                                                                                                           |
| 3, after the second round             |        560 |                                   278 | colour contrast only                                                                                                           |
| 4, after the third round              |        616 |                                   158 | colour contrast only, light theme only                                                                                         |
| 5, after the last round (this record) |        616 |                                     0 | none                                                                                                                           |

(Runs 2 and 3 had 10 roles; the auditor was added from run 4. The numbers are page loads with a violation, not the number of
distinct defects.)

In the final run (616 loads, all 11 roles, both viewports, both themes): **axe reported no violation on any page; no horizontal scroll at 360 px or 1280 px on any page, no console error or warning (apart from
the browser's own line for an expected 4xx answer that a test provoked), no failed request except the provoked ones, and no CSP
violation.** The one violation that used to appear on every signed-in page (zod's `eval` probe) is gone since pull request 90.

## What the pass found, and what was done

Fixed in `fix/ui-r09-browser-pass-1`:

1. **Colour contrast** below 4.5:1 in many small texts of the light theme (the grey of hints, sub-lines, panel subtitles, table headings,
   card footers, the page description, the company label, the avatar initials, the grey status chip, calendar dates) and in the dark
   theme (the avatar, the approval summary and publishing readiness boxes, the approval post preview, the upload label, the calendar
   day names, the company cards' brand count). One grey of `#5b6a78` replaces the lighter ones; dark rules were added where a light
   box had stayed light.
2. **A table that scrolls sideways on a phone could not be reached with the keyboard** (axe "scrollable region focusable", 90 pages):
   a wide table is now a labelled, focusable region.
3. **The closed phone menu could be reached with Tab** (focus went to controls nobody could see); a closed menu is now hidden from the tab
   order (the same rule was applied to the desktop sidebar after "Hide navigation", which was **not** separately tried). **Escape did not close the phone menu**; it does.
4. **No "skip to main content" link** (added; its presence was checked, I did not walk it with the keyboard separately) and **every screen had the same browser tab title**; each now has its own ("Publishing · DCC").
5. **The "not available for your role" page and the 404 page had no heading** (no `h1`); both have one now.
6. **Form errors in zod's own words** ("Too small: expected array to have >=1 items", "Invalid input: expected string, received
   undefined") in the composer, comments, incident and other forms; common cases are now said plainly ("Choose at least one.", "This is
   required.", "Use at least 2 characters."). This helper is shared by every form.
7. **The button "Lift freeze" had a spoken name that did not start with its visible words**; it does now ("Lift freeze: ...").
8. **The publish dialog briefly showed "No target account has an engine channel" while the post's versions were still loading**; it
   now waits for them (checked with the versions request slowed by 1.5 seconds).
9. **The browser asked for a site icon on every page and got a 404** (a console error on the first page of every session); the app now has one.

Found and **not** fixed (needs a decision or another area):

- **People the viewer may not list appear as "Person 4b5e7da0"** (for example the requester in the publisher's publication list): a
  role without `user.read` gets no names. The API would have to return display names for such records. Hirko / Dawit.
- **The 404 page keeps the default tab title** (the page's own title is not picked up by Next for the not-found page). Cosmetic.
- **Older forms keep their error text until the next submit** even after the field is corrected (the composer, for example). The new
  dialogs of this work clear a field's error as the person types; the older ones were not changed.
- **A browser-pass finding about the environment, not the product**: after switching the checkout to a branch with a new migration
  the development backend answered 500 (`function audit_append(...) does not exist`, then `incident_detail` tables) until
  `npm run db:migrate` was run. Nothing to fix, but it looks like a bug on the screen: the 500 shows only "Something went wrong" and
  a request id.

## What this pass did not cover

- **Not run at all**: sign-in through the real SSO (dev sessions were used), media upload in the composer, registering and linking a social
  account, creating a company or brand, granting or removing a role, editing an approval rule, exporting the audit trail, the
  "sign in again" flow (`DCC_REAUTH_MAX_AGE_MINUTES=0` in development), the security screen's actions, a mobile browser (only a narrow
  desktop window), Firefox and Safari, a screen reader, 200 percent zoom and text resize, Amharic.
- **Practice engine only.** Nothing here proves a post on a real network, the real inbox, or any Postiz behaviour (W-03, W-08).
- **Reading the screens as a role is not a test of what the role may do.** The screens were opened as every role, but the permissions of
  each action were not exercised for every role: only the roles named in the write flows above were used for writes. The role scripts
  in `UAT-SCRIPTS.md` remain to be run by people.
- **Axe finds only part of the accessibility problems.** A pass with no axe violation is not a pass of WCAG 2.2 AA; the plan in
  `ACCESSIBILITY-AND-USABILITY-TEST-PLAN.md` (L-19) is still to be run with people.
- The write flows were run once each at 1280 px (the first chain also at 360 px), light theme.
- Practice records created in the development database by this pass (users `pw.*@example.test`, drafts, an approved and a published post, a cancelled schedule, a freeze that was lifted, practice incidents, an archived category and contact) were left in it.

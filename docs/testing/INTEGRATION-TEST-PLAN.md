# Integration test plan: web, API, SSO and engine together (L-18)

Owner: Dawit. Testers: the team, then Abenezer with the business users ([UAT scripts](UAT-SCRIPTS.md)).

## What is already tested automatically, and what this plan adds

| Layer                                                                                                  | How it is tested today                             | Runs                             |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------- |
| Rules, roles and permissions (`portal/contracts`)                                                      | 11 unit tests                                      | every pull request (CI)          |
| Engine interface, approval gate, Postiz adapter against stand-ins                                      | 26 unit tests                                      | every pull request               |
| The API against a real PostgreSQL: every module, company isolation, audit, sessions, re-authentication | 289 tests, with attack tests                       | every pull request               |
| **The pieces together, in a browser, with the real SSO**                                               | **this plan: by hand now, automated where marked** | each release, on the test server |
| **The API with a real Postiz**                                                                         | **this plan, section E: not possible until W-03**  | each release                     |

Automated tests cannot see three things, and those are what this plan is for: the real SSO in a real browser, the screens
agreeing with the API and the database, and the real engine.

## Where and with what

- **Where:** the test server (decision D-04). Until it exists: the mirror on Dawit's PC with the mirror SSO started
  (`start-mirror-all.ps1`), which is the same shape without HTTPS.
- **People:** one test person per role, in the test SSO, each with an authenticator app. Never real staff accounts, never
  production data. The eleven roles and the fictional companies come from `npm run db:seed`.
- **Record:** for each test write pass or fail, the date, who ran it, and for a failure the **request id** shown in the error.
  A test passes only when the tester **saw** the expected result on the screen and, where it says so, in the database or the
  audit trail. A status code alone is not a pass.

## A. Sign-in and session (with the real SSO)

| #   | Test                                                                                            | Expected                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Sign in as a person with an authenticator app                                                   | the SSO asks for password and code; DCC opens; `/api/me` shows the person; an `auth.login` audit event                                                 |
| 2   | Wait 16 minutes, then grant a role                                                              | DCC asks to sign in again; the SSO asks for the password and code again; back in DCC the grant works; the audit event carries `reauthentication: true` |
| 3   | Sign in as a person **without** an authenticator app                                            | refused at the SSO with the instruction to turn it on; no DCC session                                                                                  |
| 4   | Remove `dcc` from the SSO's two-factor list (test SSO only), sign in with password only         | DCC refuses: "Sign-in could not be completed"; audit reason `mfa_required`. Put `dcc` back                                                             |
| 5   | Sign out of DCC                                                                                 | signed out of the SSO too; the back button shows nothing                                                                                               |
| 6   | While signed in, disable the person in the SSO console                                          | the next click in DCC says the session has ended (back-channel logout), within seconds                                                                 |
| 7   | Remove the `dcc-group-admin` application role in the SSO from an administrator who is signed in | their session ends; after signing in again they are no longer group administrator                                                                      |
| 8   | Leave DCC untouched for 31 minutes                                                              | the next click asks to sign in                                                                                                                         |
| 9   | Open the browser's storage and cookie views after sign-in                                       | one HttpOnly cookie; nothing in local or session storage; no token in any response                                                                     |
| 10  | Stop the SSO, press sign in                                                                     | back on the DCC page with a message; no error page                                                                                                     |
| 11  | Copy the callback address of a finished sign-in and open it again                               | "Sign-in could not be completed": a sign-in attempt works once                                                                                         |

## B. Screens, API and database agree (three-layer parity)

For every screen that is connected to the API, check each of these. One mismatch is a defect, whichever layer is "right".

| #   | Check                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12  | Every limit shown or enforced on the screen (length, required, allowed values) is the same as the API's schema in `portal/contracts` and the database's constraint. Try one character over each limit and each empty required field                                       |
| 13  | Every status the database allows can appear on the screen with a readable label, and no label exists for a status the database cannot hold. Content: draft, in review, approved, rejected, published, archived. Accounts: active, needs attention, disconnected, archived |
| 14  | Every button the role cannot use is absent or disabled, **and** the API refuses the same action when called directly (403). The screen hides; the API protects                                                                                                            |
| 15  | A refusal from the API shows the API's message on the screen, with the request id, not a blank page or a generic "error"                                                                                                                                                  |
| 16  | After every action, reload the page: what the screen shows is what the database holds                                                                                                                                                                                     |
| 17  | Under `/dcc` (mirror or server), every link, redirect and download works. No address with `/dcc/dcc`, none without `/dcc`                                                                                                                                                 |

## C. The publishing path, end to end (with the fake engine until W-03)

| #   | Test                                                                              | Expected                                                                               |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 18  | Creator drafts, submits; a different person approves; a publisher publishes       | one publication, status published; the item says published; five audit events in order |
| 19  | The creator tries to approve their own item                                       | refused, with the reason                                                               |
| 20  | A second person rewrites the text, submits, and tries to approve                  | refused: they wrote a version                                                          |
| 21  | Approve, then edit the text, then publish without a new approval                  | refused: the item is a draft again                                                     |
| 22  | Press publish twice quickly                                                       | one publication, one call to the engine                                                |
| 23  | Freeze the company, then publish an approved item; lift the freeze, publish again | refused while frozen; published after. Lifting asks for a recent sign-in               |
| 24  | Archive the account, then publish an item approved for it                         | refused: the account is archived                                                       |
| 25  | A group-level reviewer signs in after a company creator submitted                 | the notification is there                                                              |

## D. Company separation, by hand

| #   | Test                                                                                                                             | Expected                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 26  | As company A's administrator, open an address that contains an id from company B (item, account, approval, incident, membership) | "not found" every time, never "forbidden" and never the record |
| 27  | As company A's administrator, grant a role in company B, and grant yourself a role                                               | both refused                                                   |
| 28  | As an auditor of company A, search and export the audit trail                                                                    | only company A's events                                        |

## E. With a real Postiz (blocked until W-03 and W-09)

| #   | Test                                                                             | Expected                                                                                       |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 29  | List channels; publish an approved item to a test account; see it on the network | the post exists once; DCC records the engine's id                                              |
| 30  | Stop Postiz in the middle of a publish                                           | the publication stays pending, the audit trail says the outcome is unknown, a retry is refused |
| 31  | Post directly inside Postiz, bypassing DCC                                       | the reconciliation job raises an incident (W-05)                                               |
| 32  | Read and reply to a comment through DCC                                          | the reply appears on the network; an audit event for the reply (W-08)                          |

## F. Operations

| #   | Test                                                                | Expected                                            |
| --- | ------------------------------------------------------------------- | --------------------------------------------------- |
| 33  | Deploy the release with the runbook, then roll back the code        | both verified as the runbook says                   |
| 34  | Back up, restore into a scratch database, compare with the manifest | audit head and row counts equal                     |
| 35  | `checkpoint-cli.js write`, then `verify`                            | all agree                                           |
| 36  | Restart the server                                                  | DCC is back without anyone logging in to the server |

## Automated at API level (H-13, 2026-11-24)

Everything in sections B, C and D that needs no browser now runs on every pull request, over HTTP against the real application,
a real PostgreSQL and the fake engine. The test number in each test's name is this plan's number, so a failure points here.
Shared setup: `portal/backend/test/plan-harness.ts`.

| Plan tests | File                                                               | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C18 to C25 | `portal/backend/test/plan-c-publishing-path.e2e.test.ts` (8 tests) | The whole path: write, submit, a different person approves, a publisher publishes (one publication, item published, **four** audit events in order: drafted, submitted, approved, published: the plan said five); own item and own rewrite cannot be approved; an edit after approval sends the item back to draft and publish is refused; two quick publishes make one publication and one engine call; a frozen company cannot publish, lifting the freeze needs a recent sign-in (401 `reauth_required` with an old one); an archived account cannot be published to; a group-level reviewer is notified                                                                                                                                                                                                                                                     |
| B12        | `plan-b-parity.e2e.test.ts`                                        | For company, brand, account, content, incident, freeze reason, approval comment and inbox reply: at the contract's limit the API accepts and the database keeps every character, one over is a 400 with the request id, empty is a 400                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| B13        | `plan-b-parity.e2e.test.ts`                                        | The values of every database status and role constraint equal the contract's lists (content, approval, publication, account, company, incident, severity, category, platform, notification event, role); every account status can be set through the API and reads back; one the database cannot hold is refused. **The readable labels on the screen stay a browser test**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| B14        | `plan-b-parity.e2e.test.ts`                                        | Read from the controllers themselves: every route needs a named permission, is public on purpose, or is on a short fixed list open to any signed-in person (a new route without a permission fails the test); then all eleven roles call every guarded route and get the permission gate's 403 on exactly the routes whose permission they lack. **That the button is hidden stays a browser test**                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| B15        | `plan-b-parity.e2e.test.ts`                                        | 401, 400, 403, 404 and 409 share one error shape with a readable message and a request id equal to the `X-Request-Id` header; no stack or database text; an inbound request id is kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| B16        | `plan-b-parity.e2e.test.ts`                                        | After company, brand, account, content (with a new version), incident and freeze actions, reading back through the API equals the database row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D26 to D28 | `plan-d-company-separation.e2e.test.ts` (8 tests)                  | Two companies of one group and one company of another group, each with content in every state, a publication, an incident, a picture, a freeze, a policy and an inbox message; four attackers who hold **every** role of their level. Every list route (found from the controllers) shows them none of another company's or group's markers, ids or e-mails; their own data does show (so the checks are not passing on empty answers); every by-id read of another company's record is 404; every by-id change is 404 where their roles include the permission (the permission gate's own 403 where they do not), nothing is created in another company, and the database rows of all three companies are byte-identical afterwards; grants across companies and to oneself are refused; a company auditor's search and export hold only that company's events |

**Not automated, and why:** A (the real SSO in a real browser: scripted separately), B17 (`/dcc` links: a browser), the labels and hidden buttons
of B13 and B14 (a browser), C with a real engine and everything in E (a real Postiz: W-03, W-09), F (a server).

**Finding of this pass (D28c).** Audit events that belong to no company (`company_id` null: creating a content category, a
group-level role grant, an export, a denied request) are visible to a group-level auditor of **any** group: the policy
`audit_events_select` allows `company_id is null and cardinality(app_group_ids()) > 0`, the audit controller adds
`company_id is null` for every group-level holder of `audit.read`, and the table has no group column to narrow by. With one group
in the pilot nobody is exposed; before a second group is added the table needs a group column (a change to the audit chain: the
architect decides). `D28c` is written with `it.fails`: it passes while the defect exists and fails the day it is fixed, which is the
moment to make it a plain `it`.

## State on 2026-11-14

| Tests                              | State                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18 to 25, 26 to 28                 | **automated at API level 2026-11-24 (section above), all passing**; not yet run through the screens. Every screen has been connected to the API since 2026-11-15; the scripted browser pass is still to do (R-09)                                                                                       |
| 33 (without a real server), 34, 35 | run on the mirror and on development data on 2026-11-14: passed                                                                                                                                                                                                                                         |
| 10                                 | run 2026-11-14: at a cold start DCC returns to its page with the message (mirror, API); once DCC knows the SSO, the browser is sent there and shows its own "cannot connect" page (browser). Both recorded                                                                                              |
| 1 to 9, 11                         | **run in a real browser against the dev SSO on 2026-11-14: all passed** ([browser run of 2026-11-14](results/2026-11-14-SSO-BROWSER-RUN.md)). Test 5 with one note: where DCC and the SSO are on different addresses the browser does not return to DCC after sign-out (an SSO limit, development only) |
| 12 to 16                           | API half **automated 2026-11-24, passing** (limits, statuses, role matrix, error shape, read-back); the screen half (labels, hidden buttons) waits for the browser pass (R-09). 17 (`/dcc` links): **not run**, a browser                                                                               |
| 29 to 32, 36                       | **blocked**: Postiz (W-03, W-09), the server (D-04)                                                                                                                                                                                                                                                     |

## How section A is run

`scripts/verify/sso-browser-checks.mjs` drives a real browser through the SSO's own pages. It is run by hand on a development
setup (never the mirror or production), needs the SSO's test people and a browser driver from another checkout, and puts the
SSO's test people back as it found them. Its header says how to start it.

## What to automate next

Sections B, C and D are automated at API level (above). Next: the screen half of B (labels, hidden buttons, `/dcc` links) and
tests 18 to 23 as browser tests through the screens. Adding Playwright is a new dependency: Dawit approves it then.

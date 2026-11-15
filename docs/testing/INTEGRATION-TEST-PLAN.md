# Integration test plan: web, API, SSO and engine together (L-18)

Owner: Dawit. Testers: the team, then Abenezer with the business users ([UAT scripts](UAT-SCRIPTS.md)).

## What is already tested automatically, and what this plan adds

| Layer                                                                                                  | How it is tested today                             | Runs                             |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------- |
| Rules, roles and permissions (`portal/contracts`)                                                      | 11 unit tests                                      | every pull request (CI)          |
| Engine interface, approval gate, Postiz adapter against stand-ins                                      | 13 unit tests                                      | every pull request               |
| The API against a real PostgreSQL: every module, company isolation, audit, sessions, re-authentication | 203 tests, with attack tests                       | every pull request               |
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

## State on 2026-11-14

| Tests                              | State                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18 to 25, 26 to 28                 | covered by automated API tests; **not yet run through the screens** (most screens are not connected to the API yet)                                                                                                                                                                                     |
| 33 (without a real server), 34, 35 | run on the mirror and on development data on 2026-11-14: passed                                                                                                                                                                                                                                         |
| 10                                 | run 2026-11-14: at a cold start DCC returns to its page with the message (mirror, API); once DCC knows the SSO, the browser is sent there and shows its own "cannot connect" page (browser). Both recorded                                                                                              |
| 1 to 9, 11                         | **run in a real browser against the dev SSO on 2026-11-14: all passed** ([browser run of 2026-11-14](results/2026-11-14-SSO-BROWSER-RUN.md)). Test 5 with one note: where DCC and the SSO are on different addresses the browser does not return to DCC after sign-out (an SSO limit, development only) |
| 12 to 17                           | **not run**: wait for the screens (R-06)                                                                                                                                                                                                                                                                |
| 29 to 32, 36                       | **blocked**: Postiz (W-03, W-09), the server (D-04)                                                                                                                                                                                                                                                     |

## How section A is run

`scripts/verify/sso-browser-checks.mjs` drives a real browser through the SSO's own pages. It is run by hand on a development
setup (never the mirror or production), needs the SSO's test people and a browser driver from another checkout, and puts the
SSO's test people back as it found them. Its header says how to start it.

## What to automate next

Section A is scripted (above). Next: tests 18 to 23 as browser tests through the screens, once the approvals and content screens
are connected. Adding Playwright is a new dependency: Dawit approves it then, not before there are screens to test.

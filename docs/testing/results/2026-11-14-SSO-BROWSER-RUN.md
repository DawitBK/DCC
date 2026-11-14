# Record: sign-in tests in a real browser against the SSO, 2026-11-14

Run by Dawit's engineering assistant with `scripts/verify/sso-browser-checks.mjs`. This is section A of the
[integration test plan](../INTEGRATION-TEST-PLAN.md), plus the checks of the key file.

## Setup

| Part         | What ran                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser      | Microsoft Edge, driven by Playwright, through the SSO's own pages (password form, authenticator code, sign-out confirmation)                                                                                             |
| SSO          | the development SSO and its development database. Windows had reserved ports 7291 to 7390 that day, so it ran on 7500 (backend) and 7501 (frontend) from a private copy of its settings. Its source was not changed      |
| DCC          | the development backend and frontend, with two-factor **required**, the **key-file** secrets provider, and the development database with all 12 migrations                                                               |
| People       | three of the SSO's test people: one given an authenticator and the DCC administrator role, one given an authenticator and no role, one with no authenticator. Put back as found at the end (two-factor off, no DCC role) |
| Time windows | run 1: sign in again after 1 minute, idle timeout 2 minutes (so the whole set fits in six minutes). Run 2: the real 15 and 30 minutes, for the tests that depend on them                                                 |

## Results, run 1 (short windows): 13 of 13 passed

| Test | What                                                                 | What was seen                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Sign in as a person with an authenticator app                        | the SSO asked for password and code; DCC opened; `/api/me` shows the person as group administrator (from the SSO application role); `auth.login` is in the audit trail                                                                                  |
| 1b   | A new person signs in and has no role yet                            | the SSO asked for password and code; no memberships; the page says an administrator has not given a role yet                                                                                                                                            |
| 1c   | The administrator gives the new person their first role by email     | the person was not in the people list; `POST /api/memberships` with the email answered 201; their page then showed the role                                                                                                                             |
| 2    | A sensitive action after the sign-in became too old                  | 401 with `code: reauth_required` while ordinary requests kept working; the SSO asked for password **and** code again although its own session was alive; the grant then answered 201; the audit event says re-authentication; the old session was ended |
| 3    | A person without an authenticator app                                | refused at the SSO: "Two-factor sign-in is required for this application. Turn it on under Portal > Security, then come back."; no DCC session                                                                                                          |
| 4    | DCC's own lock: DCC taken off the SSO's two-factor list for the test | the SSO let a password-only sign-in through; DCC refused it (audit reason `mfa_required`), no session; the SSO setting was put back                                                                                                                     |
| 5    | Sign out of DCC                                                      | DCC session ended; the stored identity token was decrypted and sent to the SSO; the person confirmed on the SSO's page; the SSO session ended (the next sign-in asked for password and code). **The browser did not come back to DCC** (see below)      |
| 6    | Disable a signed-in person in the SSO console                        | their DCC session ended about one second after the click; `auth.backchannel_logout` is in the audit trail                                                                                                                                               |
| 7    | Remove the DCC administrator role in the SSO                         | the session ended at once; after signing in again the person was no longer group administrator; the revocation is in the audit trail                                                                                                                    |
| 8    | Leave a session untouched past the idle timeout                      | 401 "Your session has ended. Sign in again."                                                                                                                                                                                                            |
| 9    | What the browser holds after sign-in                                 | localStorage and sessionStorage empty; one cookie, HttpOnly, SameSite=Lax, invisible to the page; no token in `/api/me`                                                                                                                                 |
| 11   | Open the callback address of a finished sign-in again                | back on DCC with "sign-in could not be completed"; no session                                                                                                                                                                                           |
| K1   | Key file                                                             | the stored identity token is in the key-file format (`v2`, key `k20261114`); the session remembers the SSO's sign-in time                                                                                                                               |

## Results, run 2 (the real windows)

5 of 5 passed, with the backend on its real settings (sign in again after 15 minutes, idle timeout 30 minutes):

| Test      | What was seen                                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 1b, 1c | as in run 1                                                                                                                                                    |
| 2         | after 15 minutes and 10 seconds of normal use the grant answered 401 `reauth_required`; the SSO asked for password and code again; the grant then answered 201 |
| 8         | after 30 minutes and 15 seconds untouched: 401 "Your session has ended. Sign in again."                                                                        |

## Test 10, the SSO stopped

Two outcomes, both seen:

- **DCC has not talked to the SSO since it started** (seen on the mirror at the API): pressing sign in returns to the DCC page
  with "Sign-in could not be completed". Before the fix of this day it was a bare 500.
- **DCC already knows the SSO's addresses** (seen in the browser, with the SSO stopped after the runs above): DCC sends the browser
  to the SSO as usual and the browser shows its own "cannot connect" page. DCC cannot know the SSO stopped a moment ago. No DCC
  error page and no session result from it. The uptime monitor on the SSO is what catches this case.

## What the runs found

Running the real flow found things the automated tests had not, and one thing in the SSO:

1. **Nobody could be given their first role** (fixed the same day). A person with no role is in no administrator's list, and a
   role could be granted only by internal id. The automated tests took the id from their fixture. Now: grant by email.
2. **A failed start was logged as an empty line** (fixed the same day). Found by starting with a broken key file.
3. **After sign-out the browser stays on the SSO's page when DCC and the SSO are on different addresses** (not fixed: it is in
   the SSO). Both sessions do end. The SSO's sign-out page allows its form result to go only to the SSO's own address
   (`form-action 'self'`), and the browser applies that to the return trip to DCC. On one address, as on the mirror and in
   production (`/dcc` and `/sso` on the same host), the rule is met. Any application on another address than the SSO would hit
   it. Suggested fix in the SSO: on the sign-out pages, add the registered post-sign-out addresses of its clients to that rule.
4. **The mirror SSO is read-only**: its licence expired on 2026-11-05, so a test person cannot enrol an authenticator there.
   That is why this run used the development SSO. Renewing the licence is the owner's act.
5. **Windows had reserved the development SSO's ports** (7300 and 7301 were inside a reserved range that day).

## What this run does not prove

- Nothing here ran on the mirror or on a server: no Apache, no HTTPS, no `/dcc` path. Step 8 of the
  [registration procedure](../../identity-and-sso/PRODUCTION-CLIENT-REGISTRATION.md) repeats the core of it there.
- For test 4 the SSO setting was changed in the development SSO's database (only its platform administrator may change it in
  the console) and put back; the SSO re-reads its settings every 10 seconds.
- The screens are the small pages on `develop`. The real screens (pull request 25) are not connected to these flows yet.

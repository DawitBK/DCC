# Record: browser pass of every role and screen, sign-in checks, live engine check, 2026-11-24

Backlog rows R-09, R-07 and W-03. Run on a development computer, against the development database (migrations up to `202611241400`) and
`develop` at `cb1ebff`, plus the one fix described below. Nothing in this record touched the mirror, a server or a real network.

## What ran

| Part       | What                                                                                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser    | Chromium, driven by Playwright, at 1280 px (desktop) and 390 px (phone) wide                                                                                                                        |
| DCC        | development backend and frontend, sample data (three companies, people in every role), engine = real Postiz v2.25.3 in Docker with the practice channels (`fake-` ids); nothing leaves the computer |
| People     | one development session per role (`npm run dev:session`), all 11 roles                                                                                                                              |
| SSO checks | the development SSO (7300 / 7301) and `scripts/verify/sso-browser-checks.mjs`                                                                                                                       |

## 1. Every role, every screen: 308 pages, 0 findings

11 roles x 14 screens x 2 widths. For each page: it answers 200, shows its content (or the "not available for your role" notice),
produces no console error, no page error, no failed request, no content-security-policy violation, and does not scroll sideways.

The screen each role may open matches the permission table in `portal/contracts/src/permissions.ts` (checked line by line). Example:
the group administrator has no inbox, audit, security or incident screen; the auditor sees only dashboard, analytics, accounts and
companies and the audit trail; the publisher sees publishing, inbox and calendar. Nothing is shown that the role may not use, and the
API re-checks it anyway.

## 2. Write flows driven through the screens

| Flow                                                                                                  | Role                          | Width             | Result                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Write a post, submit it, approve it (a different person), publish it (a third), see it leave the list | creator, executive, publisher | desktop and phone | works; it went to the practice engine (`fake-post-1`), the row left "approved" and the record says `published`                                         |
| Add a company                                                                                         | group administrator           | desktop           | saved and listed                                                                                                                                       |
| Register a social account                                                                             | group administrator           | desktop           | saved and listed                                                                                                                                       |
| Give a role by email                                                                                  | group administrator           | desktop           | answered 401 `reauth_required` (the dev session carries no SSO sign-in time): the sign-in-again rule works; the granting itself is proven in section 3 |
| Set an approval rule                                                                                  | group administrator           | desktop           | saved                                                                                                                                                  |
| Freeze a company's publishing, then lift the freeze                                                   | group administrator           | desktop           | both work (the lift button is labelled per freeze, "Lift the freeze on ..."); the freeze made for the test was lifted                                  |
| Report an incident, then resolve it                                                                   | company executive             | desktop           | both saved; the incident was listed                                                                                                                    |
| Reply in the inbox                                                                                    | marketing manager             | desktop           | "Reply sent", the message shows "Replied" with its first-reply time                                                                                    |
| Cancel a scheduled post                                                                               | marketing manager             | desktop           | a dialog says what will happen; confirming cancelled it                                                                                                |

Not driven in the browser, only by API tests: assigning an inbox message, settling a stuck publish key, the bypass check, media upload from
the composer, editing and archiving companies and brands, removing a role. They have API tests; a screen pass for them remains.

Left behind in the development database by this pass: one company, one account, a few posts and one incident whose names start with
"R09", one inbox reply, one cancelled schedule, one approval rule. They are sample data on a development computer.

## 3. Sign-in checks against the real SSO: 13 of 13

`scripts/verify/sso-browser-checks.mjs`, development SSO, run in three parts because the checks need different settings: short windows
(sign in again after 1 minute, idle time 2 minutes) for most, and `DCC_REQUIRE_MFA=true` for check 4.

| Test | What                                                             | Result                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Sign in with password and authenticator code                     | passed                                                                                                                                                                               |
| 1b   | A person with no role is told so                                 | passed                                                                                                                                                                               |
| 1c   | The administrator gives a first role by email                    | passed (201)                                                                                                                                                                         |
| K1   | Session stored with the key file, sign-in time remembered        | passed                                                                                                                                                                               |
| 2    | After the window, a role grant asks to sign in again, then works | passed: 401 `reauth_required`, the SSO asked for password and code although its own session was alive, then 201, audit says re-authentication (this is **R-07**, for the role grant) |
| 3    | A person without an authenticator is refused                     | passed                                                                                                                                                                               |
| 4    | DCC's own two-factor lock when the SSO would let a password in   | passed with `DCC_REQUIRE_MFA=true`; with `false` (the development setting chosen on 2026-11-14) DCC lets it through, as decided                                                      |
| 5    | Sign-out of DCC signs out of the SSO                             | passed (the return to DCC is blocked only because DCC and the SSO are on different addresses here)                                                                                   |
| 6    | Disabling a person in the SSO ends their DCC session             | passed, 1.2 s                                                                                                                                                                        |
| 7    | Removing the DCC role in the SSO ends the session and the role   | passed                                                                                                                                                                               |
| 8    | A session left alone for longer than the idle time ends          | **failed first, fixed, passed** (below)                                                                                                                                              |
| 9    | The browser holds one HttpOnly cookie and nothing in storage     | passed                                                                                                                                                                               |
| 11   | The callback address of a finished sign-in does nothing twice    | passed                                                                                                                                                                               |

Before these could run, the script itself was out of date with the screens and was corrected: the home page link now reads "Continue with
Kerchanshe SSO", the signed-in page greets with "Good day, ...", and the page for a person with no role has new wording.

### Finding: an open tab kept the session alive for ever (fixed)

Check 8 failed: after more than the idle time the session was still valid. Cause: the notification bell asks the API how many items are
unread once a minute, and the API treated every request, including that one, as activity. A tab left open and unattended therefore never
timed out, which defeats `SESSION_IDLE_MINUTES`.

Fix: requests the page makes by itself now carry `X-DCC-Background: 1`; the API still checks the session (a session past the idle limit is
refused) but does not extend it. Contract: [API README](../../api/README.md). Proof that the test is real: the new test
`a background poll is checked but does not keep an idle session alive` in `portal/backend/test/api.e2e.test.ts` fails without the fix and
passes with it, and check 8 in the real browser failed before and passed after (401 "Your session has ended" after 135 s).

## 4. The engine adapter against the live Postiz

`npm run verify:live -w @dcc/engine-client` with a local JPEG: authentication and channel listing, listing posts, a wrong key refused,
a channel the engine does not have refused, an unreachable engine reported as "outcome unknown", and **uploading a picture without
publishing it** all pass. Still skipped: scheduling and deleting a post, because no real channel is connected (needs a developer app,
W-04).

## What this record does not show

- A full pass of the screens above on a **phone** for every write flow (only the post lifecycle was driven at phone width; every screen
  was loaded and checked for overflow at phone width).
- The other two sensitive actions (`R-07` names three) after the real 15-minute window; the window was shortened to one minute and the
  role grant was used.
- Anything on a server or through the mirror's Apache.
- A real post on a real network.

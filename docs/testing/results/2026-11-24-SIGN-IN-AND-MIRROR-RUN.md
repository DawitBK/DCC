# Record: real-SSO sign-in checks, administration flows, live engine check and the mirror, 2026-11-24

Companion to [the browser pass of the same day](2026-11-24-BROWSER-PASS.md) (screens, themes, keyboard, accessibility, the main write
flows). This record covers what that one lists as not covered: the real SSO, the re-authentication flow, role grants, rule editing,
media upload, and the mirror behind Apache. Backlog rows R-05, R-07, R-09 and W-03. Development computer, development database,
`develop` at `cb1ebff` plus the fixes below. Nothing here touched a server or a real network.

## 1. Sign-in checks against the real SSO: 13 of 13

`scripts/verify/sso-browser-checks.mjs` against the development SSO (7300 / 7301), in three parts because the checks need different
settings: short windows (sign in again after 1 minute, idle time 2 minutes) for most, and `DCC_REQUIRE_MFA=true` for check 4.

| Test | What                                                             | Result                                                                                                                                                                                                  |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Sign in with password and authenticator code                     | passed                                                                                                                                                                                                  |
| 1b   | A person with no role is told so                                 | passed                                                                                                                                                                                                  |
| 1c   | The administrator gives a first role by email                    | passed (201)                                                                                                                                                                                            |
| K1   | Session stored with the key file, sign-in time remembered        | passed                                                                                                                                                                                                  |
| 2    | After the window, a role grant asks to sign in again, then works | passed: 401 `reauth_required`, the SSO asked for password and code although its own session was alive, then 201, the audit says re-authentication, the old session ended (**R-07**, for the role grant) |
| 3    | A person without an authenticator is refused                     | passed                                                                                                                                                                                                  |
| 4    | DCC's own two-factor lock when the SSO would let a password in   | passed with `DCC_REQUIRE_MFA=true`; with `false` (the development setting chosen on 2026-11-14) DCC lets it through, as decided                                                                         |
| 5    | Sign-out of DCC signs out of the SSO                             | passed (the return to DCC is blocked only because DCC and the SSO are on different addresses here)                                                                                                      |
| 6    | Disabling a person in the SSO ends their DCC session             | passed, 1.2 s                                                                                                                                                                                           |
| 7    | Removing the DCC role in the SSO ends the session and the role   | passed                                                                                                                                                                                                  |
| 8    | A session left alone for longer than the idle time ends          | **failed first, fixed, passed** (below)                                                                                                                                                                 |
| 9    | The browser holds one HttpOnly cookie and nothing in storage     | passed                                                                                                                                                                                                  |
| 11   | The callback address of a finished sign-in does nothing twice    | passed                                                                                                                                                                                                  |

The script had drifted from the screens and was corrected first: the home page link now reads "Continue with Kerchanshe SSO", the
signed-in page greets with "Good day, ...", and the page for a person with no role has new wording.

### Finding: an open tab kept the session alive for ever (fixed)

Check 8 failed: after more than the idle time the session was still valid. The notification bell asks the API how many items are unread
once a minute, and the API treated every request, including that one, as activity, so an unattended open tab never timed out and
`SESSION_IDLE_MINUTES` did nothing.

Fix: requests the page makes by itself carry `X-DCC-Background: 1`; the API still checks the session (one already past the idle limit is
refused) but does not extend it. Contract: [API README](../../api/README.md). Proof: the test
`a background poll is checked but does not keep an idle session alive` in `portal/backend/test/api.e2e.test.ts` fails without the change
and passes with it; check 8 failed in the real browser before and passed after (401 "Your session has ended" after 135 s).

## 2. Administration flows driven through the screens (desktop width)

Done with the group administrator's practice session marked as freshly signed in (the sign-in-again rule itself is section 1; without
the mark these answer 401 `reauth_required`, which is the rule working). The other flows of the day are in the companion record.

| Flow                                                   | Result                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Add a company, register a social account               | saved and listed                                                             |
| Set an approval rule                                   | saved                                                                        |
| Rename a company, add a brand, archive the company     | each saved and shown                                                         |
| Give a role by email, then remove it                   | granted and listed; the dialog says who loses which role; confirmed, removed |
| Upload a picture in the composer, save a draft with it | uploaded (one thumbnail), draft saved                                        |
| Freeze and lift (phone width too)                      | both work; the lift button is labelled per freeze, "Lift the freeze on ..."  |

No console error and no failed request apart from the 401 above. Test data left in the development database carries the names "R09".

## 3. The engine adapter against the live Postiz

`npm run verify:live -w @dcc/engine-client` with a local JPEG: authentication and channel listing, listing posts, a wrong key refused, a
channel the engine does not have refused, an unreachable engine reported as "outcome unknown", and **uploading a picture without
publishing it** all pass. Still skipped: scheduling and deleting a post, because no real channel is connected (needs a developer app,
W-04).

## 4. The content security policy behind Apache, on the mirror (R-05)

The mirror (migrated with `npm run mirror:db`, rebuilt with `npm run build:mirror`, started with `start-mirror-all.ps1`) serves the app
at `/dcc` through its Apache on 8090. Checked with curl and a real browser: the page `/dcc` answers with exactly one
`Content-Security-Policy` header, loads and hydrates, the "Continue with Kerchanshe SSO" link leads to the SSO's sign-in page, and the
browser reports no violation, console error or failed request.

**Finding (fixed):** before the fix `/dcc` itself, the home and sign-in page, came out with **no** policy at all, while `/dcc/dashboard`
and a 404 page had one. Under a base path the home page's path is empty and the matcher in `portal/frontend/src/proxy.ts` did not match
it. The matcher now has an entry for the root. No automated test (the frontend has no test runner); the proof is the header before and
after on the mirror build. The other record's production-build runs had no base path, which is why it did not show there.

## What this record does not show

- The administration flows at phone width (only the freeze and lift were repeated there).
- The other two sensitive actions (`R-07` names three) after the real 15-minute window: the window was one minute and the role grant was
  used.
- A signed-in session through the mirror's Apache (only the signed-out home page was checked there), and media upload through it.
- A real post on a real network.

# Record: the mirror signed in, the audit checkpoint job, and the sign-in-again return trip, 2026-11-25

Continues [the record of 2026-11-24](2026-11-24-SIGN-IN-AND-MIRROR-RUN.md), which listed these as not shown. Development computer and the mirror on the
same PC (decision D-28: the mirror is the test and UAT environment). Nothing here touched a server or a real network. **Correction of the earlier
record:** it said a signed-in pass on the mirror was left undone because the mirror "holds real accounts". That was wrong. The mirror database holds 23
sample people and two sign-ins of the owner's, and the owner's decision 7 of 2026-11-15 says the mirror is a place to try things.

## 1. The mirror, signed in, through Apache (R-05, R-09)

The mirror (`http://localhost:8090/dcc`, the built mirror web app and API, native PostgreSQL `dccprod`) with a session for one sample person of each of the
**eleven roles** (made the way the sample-data script makes them), driven by a real Chromium at 1280 and 390 px wide:

| What                                           | Result                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 11 roles x 14 screens x 2 widths               | **308 page loads, 0 findings**: no console error or warning, no failed request, no content security policy violation, no horizontal scroll |
| Content security policy header per page        | exactly one on every page (the page `/dcc` itself had none before the 2026-11-24 fix)                                                      |
| Picture upload in the composer, through Apache | the file uploaded (one thumbnail), the draft saved: "Saved. The post was read again from DCC."                                             |

## 2. The audit checkpoint as a job, with the second place on the Linux host (L-09, D-06)

`scripts/windows/run-audit-checkpoint.ps1`: verifies the earlier checkpoints, writes a new one to this PC and to the second place, verifies again, and logs.
The second place was a folder inside WSL Ubuntu (`\\wsl.localhost\Ubuntu-24.04\...`), the sealing key a file kept there. Run by hand: `OK: audit checkpoint: 159 events,
last event 159, chain ok | audit checkpoints: 2 checked against \\wsl.localhost\...: all agree`, exit 0.

- **Not done by an assistant:** registering it as a daily task (`scripts/windows/register-audit-checkpoint-task.ps1`, 18:30 and ten minutes after sign-in). The
  permission check refused it; it is one command for the owner.
- **Honest limit:** on one PC the second place is the same person's machine. This proves the job and the format, not the separation. The live server needs another drive or machine.
- **A stray folder from my own first attempt** (Git Bash turned the network path into `C:\wsl.localhost\...`): empty apart from one test checkpoint line; the removal was blocked by the safety check, so the owner can delete `C:\wsl.localhost`.

## 3. The sign-in-again return trip, after the real window (R-07)

**Result: passed**, 2026-11-25, with the real 15-minute window and the real SSO.

How it was run: the dev SSO (backend 7300, frontend 7301), the dev DCC backend on its **default** timings (sign-in again after 15 minutes, idle timeout 30; the shortened values in the development `.env` were overridden on the command line), Microsoft Edge driven by Playwright (outside the repository),
`CHECKS=12 node scripts/verify/sso-browser-checks.mjs`, with the SSO's practice people (`qa.*@qa.local`).

What check 12 does: it signs six sessions in, waits until every sign-in is older than 15 minutes (915 seconds), and then, one session per action, does each of the six sensitive actions **from its own screen**. Each time the screen must send the person to the SSO, the SSO must ask for
the password and the authenticator code again although its own session is alive, the browser must come back to the same screen, and repeating the action must work.

Result: **12 passed.** For the six actions **grant a role, remove a role, lift a freeze, remove an approval rule, set an approval rule and export the audit trail**, the screen sent the person to the SSO, the SSO asked for password and code, the browser came back to the same screen, and repeating the action worked. The test people were put back afterwards (active, two-factor off, no DCC application role).

What it took to get there (all in `scripts/verify/sso-browser-checks.mjs`; nothing in the product changed): the script predated the rebuilt screens and followed them: the grant dialog's "A new person, by email" choice, removing a role on the person's own page (`/governance/<user id>`), the Freezes tab of the Publishing screen and the confirmation of "Lift the freeze", and the "Choose how you want to work" page a person with two roles meets first. The script now names the failing action and attempt, keeps the first lines of the error and saves a screenshot, so a failure explains itself.
Attempts before the pass, for the record: a first run used a 0-minute window in the script against a 15-minute backend (the script reads the same `.env` as DCC: give both the same values); then rehearsals with 1 and 3 minutes (a 1-minute window is shorter than the script's own preparation); one run failed in the setup because the dev SSO's in-memory sign-in limiter needed a restart after many test sign-ins.

Not covered: the mirror and the live server (this tool is for development only); a seventh trip for "end a person's sessions" (the person page); a person who has more than one DCC role at every step.

## What this record does not show

- A real post on a real network (see the engine record of the same day, if the engine run produced one).
- Firefox, Safari, a real phone, a screen reader.

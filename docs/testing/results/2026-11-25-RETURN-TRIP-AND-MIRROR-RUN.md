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

RESULT_PLACEHOLDER

## What this record does not show

- A real post on a real network (see the engine record of the same day, if the engine run produced one).
- Firefox, Safari, a real phone, a screen reader.

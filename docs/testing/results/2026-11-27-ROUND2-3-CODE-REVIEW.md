# Record: code review of the Round 2 and Round 3 backend (2026-11-27)

Done by the owner's session, inline, at the owner's instruction (the pull requests 113 to 121 and 127 to 131 were merged after the automatic checks with no second reader: GitHub shows 0 reviews on them). The method was to read the paths where a mistake costs the most, try the failure first as a test, and fix what the test proved.

## What was read

- Approval decisions, emergency approval and its confirmation (`modules/content/approvals.service.ts`).
- Sensitive-reply approval, its request, decision, delivery and the plain reply route (`modules/publishing/inbox-replies.service.ts`, `inbox.service.ts`).
- The freeze and the two-person lift (`modules/publishing/freeze.service.ts`).
- Inbox claim and assignment (`inbox.service.ts`), the sweep timer (`modules/working-hours/sweep.service.ts`), the removal and correction of a published post (`publication-removal.service.ts`, the entry points), the alert contacts (`modules/alerts/alerts.service.ts`).

**Not read line by line:** the rest of the 28,000 lines of those pull requests (the inbox clock arithmetic, routing, the acknowledgement, the alert transports, most screens). They have their own automatic tests; they were not reviewed by a second reader.

## Findings, each proved by a test before the fix

| #   | Finding                                                                                                                                                                                                                                                             | Severity | Fix                                                                                                                                                                                              | Test                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1   | **Two approvers pressing Approve together never settled a two-approver request.** Each counted only their own approval, so a request with enough approvals stayed "pending" for ever (6 of 6 rounds in the test). The decisions on one request were not serialised. | High     | `loadRequestWithItem` locks the request row (`for update`): one decision at a time; the second reads what the first committed.                                                                   | `approval-concurrency.e2e.test.ts` (failed before, passes now) |
| 2   | **One person double-clicking Approve was recorded twice** (`201, 201`; the distinct count hid it but the record held two decisions).                                                                                                                                | Medium   | The same lock: the second click now answers 409 "You have already approved".                                                                                                                     | same file                                                      |
| 3   | **An emergency approval and a normal approval at the same moment both succeeded** (two settling decisions on one request).                                                                                                                                          | High     | The same lock.                                                                                                                                                                                   | same file                                                      |
| 4   | **The writer of a sensitive reply could send it around the approvers.** `POST /inbox/reply` did not look at reply requests, so a writer whose reply was rejected (or still waiting) could send the same text through the plain route.                               | High     | The plain route refuses the person who put a reply to the approvers while that request waits, was approved, rejected or failed. Somebody else (a manager's quick holding answer) is not stopped. | `inbox-reply-approval.e2e.test.ts` (new case)                  |

**Limit that stays, by design:** whether a reply is "sensitive" is declared by the writer (there is no keyword guessing, D-26 spirit). A writer who never declares it is not stopped by DCC. The audit trail records every reply with its author.

## Changes made at the owner's decisions of the same day (not review findings)

- A publishing freeze now also cancels the posts already scheduled for the frozen company or account (see `docs/api/round2.md`, "A freeze holds scheduled posts"; test `freeze-holds-scheduled.e2e.test.ts`).
- Alert mobile numbers are stored sealed through the secrets provider (migration `202611271000`; test in `alerts.e2e.test.ts`).

## Checked and found sound

- The two-person freeze lift: a per-freeze advisory lock, one person cannot give both sides, withdrawal only by the giver, a missing side named in the 409.
- Reply approval decisions: the row is locked, the writer cannot decide, the same person cannot decide twice, a frozen account stops it, the policy's roles narrow who decides.
- Inbox claim: the existing row is locked, a claim takes only a message nobody has, a simultaneous first assignment gets a clean 409.
- The sweep timer cannot overlap itself (`running` flag), one failing job never stops the others, escalations are recorded once per level.

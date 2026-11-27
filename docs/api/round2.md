# Round 2 API (2026-11-26): clocks, escalation, reply approval, emergency post, freeze lift, review

What the Marketing team's Round 2 workbook asked for and the code now does. Routes are under `/api`. Every route re-checks its permission for the company
(and group) of the thing it touches, writes an audit event in the same transaction, and is walled by row-level security. Rules and the assumptions behind them:
[APPROVAL-AND-PUBLISHING-POLICY](../requirements/APPROVAL-AND-PUBLISHING-POLICY.md), [ASSUMPTIONS](../project/ASSUMPTIONS.md) (ASM-24 to ASM-32),
decisions D-31 (the sweep) and D-32 (Content Writers answer the inbox) in [OPEN-DECISIONS](../project/OPEN-DECISIONS.md).

## The clock and the sweep

- **Working time:** Monday to Saturday 08:30 to 17:30, UTC+3, public holidays per company. `GET /working-hours?companyId=` (`company.read`), `PUT /working-hours` (`inbox.manage`).
  No row means the default calendar. Crisis clocks and an urgent message set to "round the clock" ignore it.
- **The sweep** is a timer inside the backend (`DCC_SWEEP_SECONDS`, default 60, `0` switches it off, it is off under test). It runs the jobs `inbox-clock`, `approvals`,
  `reply-approval-ladder`, `inbox-acknowledgement` and `incident_review` for every active company. Each escalation level is recorded once in `escalation_events`
  (unique on kind, target, level), so nobody is told twice. The sweep notifies; it never publishes, approves or answers a message by itself
  (the two things it does act on: it moves an overdue inbox message to the backup responder, and it sends an approved acknowledgement).

## Inbox clock (H-19)

| Method and path                               | Permission                                   | What                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /inbox/priority`                         | `inbox.reply`                                | Set a message to `urgent`, `normal` or `low` (who set it is recorded)                                                                       |
| `PUT /inbox/settings`                         | `inbox.manage` (or `approval_policy.manage`) | Targets per priority (default 60 / 240 / 1440 minutes), `urgentRoundTheClock`, and `responseTargetMinutes` as an alias of the normal target |
| `GET /inbox`, `GET /inbox/settings`           | `inbox.read`                                 | Extra fields: `priority`, `dueAt`, `overdue`, `escalationLevel`, `needsManager`, `reassignmentCount`                                        |
| `GET /reports/inbox-misses?month=&companyId=` | `report.read`                                | Messages that reached 200%, per company and month                                                                                           |

Ladder (100%, 150%, 200% of the target, in working time): remind the assignee and the Digital Marketing Manager; move to the backup responder (the other `inbox.reply` holder
with the fewest open messages); tell the Marketing & Communications Manager and count the miss. A reassignment never restarts the clock; after the second the manager is told once.

## Sensitive replies, moderation, acknowledgement (H-21)

| Method and path                                                           | Permission                                        | What                                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /inbox/reply-approvals`                                             | `inbox.reply`                                     | Hold a sensitive reply (`legal_threat`, `media`, `investor`, `safety`, `personal_data`, `refund_compensation`) for approval |
| `GET /inbox/reply-approvals?companyId=&status=&forMe=`                    | `inbox.read`                                      | The requests (a writer sees their own, an approver the company's)                                                           |
| `POST /inbox/reply-approvals/:id/approve` and `/reject`                   | `content.approve`                                 | Never the writer; rejection needs a reason; the last approval sends the reply through the normal checks                     |
| `POST /inbox/moderation/hide`                                             | `inbox.moderate`                                  | Content Writer and Digital Marketing Manager                                                                                |
| `POST /inbox/moderation/delete`, `/block`                                 | `inbox.remove`                                    | Digital Marketing Manager only, written reason (5 characters or more)                                                       |
| `GET /inbox/moderation?companyId=`                                        | `inbox.moderate`                                  | The record of moderation actions                                                                                            |
| `GET`/`PUT /inbox/acknowledgement`, `POST /inbox/acknowledgement/approve` | `inbox.read` / `inbox.manage` / `content.approve` | The automatic "we received your message" text; no effect until a different person approves exactly that version             |

Moderation outcome is `done`, `recorded_only` (Postiz has no moderation: the action is recorded and the screen says the network was not changed) or `failed`.
An acknowledgement is never the first response: the response clock keeps running (regression test `inbox-ack-clock.e2e.test.ts`).

## Approvals (H-20)

| Method and path                                 | Permission                            | What                                                                                                                         |
| ----------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `PUT /approval-policies`                        | `approval_policy.manage`              | Adds `timeLimitHours` (1 to 720, null = no clock) and `clock` (`working` or `continuous`)                                    |
| `POST /approval-requests/:id/emergency-approve` | `content.emergency_approve`           | One senior person settles a pending request alone, written reason of 20 characters or more; flagged                          |
| `POST /approval-requests/:id/confirm-emergency` | `content.approve`                     | A different person (not an author, not the emergency approver) confirms within 24 hours (late is accepted and escalated)     |
| `POST /content-items/:id/category`              | `content.review` or `content.approve` | Change the category while in review, only to one needing at least as many approvals, written reason of 10 characters or more |
| `GET /approval-requests?status=expired`         | `content.review` or `content.approve` | The new `expired` state                                                                                                      |
| `GET /reports/approval-misses?month=`           | `report.read`                         | Requests that reached the last level and emergency confirmations still owed at 48 hours                                      |

An approval is valid for 7 calendar days from the final approval: the publish gate refuses it afterwards and a post cannot be scheduled beyond it. Ladder (of the limit):
50% remind the approvers, 100% open to every other approver and tell the writer, 150% and 200% tell the escalation roles (company executive, Group marketing); a crisis uses 25%, 50%, 75% of its hour.
Crisis now needs two approvals; load the matrix with `node scripts/demo/load-working-defaults.mjs --update` (`--dry-run` prints it).

## Freeze lift and post-incident review (H-22, part)

| Method and path                                                                    | Permission              | What                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /publishing-freezes`                                                         | `publishing.freeze`     | Now accepts `incidentId`; a freeze tied to a SEV1 or SEV2 incident needs two people to lift. **Also cancels the scheduled posts** of the frozen company or account (see below) |
| `POST /publishing-freezes/:id/lift-confirmations/security`                         | `security.manage`       | The security confirmation (Group CTO, Security Administrator)                                                                                                                  |
| `POST /publishing-freezes/:id/lift-confirmations/communications`                   | `publishing.lift_comms` | The communications confirmation (Marketing & Communications Manager, senior management)                                                                                        |
| `DELETE /publishing-freezes/:id/lift-confirmations/security` and `/communications` | same                    | Withdraw your own confirmation before the second arrives                                                                                                                       |
| `GET /publishing-freezes/for-communications`                                       | `publishing.lift_comms` | The freezes the communications side may confirm                                                                                                                                |
| `PUT /incidents/:id/review`                                                        | `incident.manage`       | Record the review: cause, impact, response, corrective actions, preventive measures, participants, when held                                                                   |

The old `DELETE /publishing-freezes/:id` answers 409 for a two-person freeze and names the missing side. Closing a SEV1 or SEV2 incident without a review answers 409; the review is due
five business days after the incident was first resolved, with a reminder a business day before and a notice when overdue.
Severity mapping: critical = SEV1, high = SEV2, medium = SEV3, low = SEV4. Once an incident was ever SEV1 or SEV2 the requirement stays.

## New audit actions

`working_hours.set`, `inbox.priority_set`, `inbox.escalated`, `inbox.moderated`, `inbox.ack_settings_set`, `inbox.ack_sent`, `inbox.reply_approval_requested`, `inbox.reply_approval_decided`,
`approval.reminded`, `approval.escalated`, `approval.expired`, `approval.emergency`, `approval.emergency_confirmed`, `content.category_changed`, `publishing.freeze_lift_confirmed`
(`details.event` is `confirmed` or `withdrawn`), `incident.review_recorded`, `incident.closed`. Sweep events have no human actor (`actor_subject` is `system:...`).

### A freeze holds scheduled posts (owner decision 2026-11-27)

The engine keeps a scheduled post and sends it at its time on its own, so DCC's check when it hands a post to the engine would never see it. `POST /publishing-freezes` therefore also cancels, in the engine, every post of the frozen company (or of the one frozen account) whose publication is `scheduled`: the publication becomes `cancelled` with the reason on it ("Cancelled because publishing was frozen (reason). Schedule it again after the freeze is lifted."), an audit event `publication.cancelled` with `details.reason = "publishing_freeze"` is written for each, the version's idempotency key is released, and the people who may publish are told how many were cancelled. Nothing is scheduled again by itself when the freeze is lifted: a person schedules the post again, and it needs a valid approval then. The answer to the freeze carries `scheduledCancelled` and `scheduledNotCancelled`. When the engine will not cancel a post, the post stays `scheduled` (it may still go out: check the engine), `publication.freeze_cancel_failed` is audited, and the count says so. Not covered: a publication whose hand-over has an unknown outcome (`pending`, no engine id yet) and a post handed over in the same instant as the freeze; "Check with the engine" and the stuck-key settle find those.

## Round 3 (2026-11-26)

### Remove or correct a published post (RQ-026)

| Method and path                  | Permission                                              | What                                                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /publications/:id/remove`  | `publication.remove`, then the category's `removeRoles` | `{ reason (10 to 1000 characters), incidentId? }`: deletes the post through the engine and records it as `removed` with who, when, why; the record is never erased; a freeze does not block it; an engine failure leaves it published (502, audited) |
| `POST /publications/:id/correct` | same                                                    | `{ reason, removeOriginal, incidentId? }`: a new draft copying the published version, a correction of it, through normal approval; `removeOriginal` removes the original first                                                                       |
| `PUT /approval-policies`         | `approval_policy.manage`                                | Adds `removeRoles` (empty = approver roles plus company_admin and group_admin)                                                                                                                                                                       |

`GET /publications` carries `removeRoles`, `canRemove`, `canCorrect`, `correctionContentItemIds` and the removal facts. A removed publication cannot be published again or changed back (a database trigger).
Not proven: that the Postiz fork removes an already published post from the network itself; the dialog tells the person to check the network.

### Alerts: SMS, Teams, e-mail (RQ-029)

Nothing is sent until IT sets the environment variables (all empty in `.env.example`): `DCC_TEAMS_WEBHOOK_URL`; `DCC_SMS_GATEWAY_URL` and `DCC_SMS_GATEWAY_TOKEN` (the gateway accepts `POST` JSON
`{ "to": "+2519...", "text": "..." }` with `Authorization: Bearer <token>`; a small relay can adapt a provider); `DCC_SMTP_HOST`, `DCC_SMTP_PORT`, `DCC_SMTP_USER`, `DCC_SMTP_PASSWORD`, `DCC_SMTP_FROM`, `DCC_SMTP_SECURE`
(`starttls`, `tls`, `none`). Production refuses `http://` addresses. A channel with no configuration is "not configured": it creates nothing and the screen says so.

| Method and path                                         | Permission                   | What                                                                                      |
| ------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /alerts/status`                                    | `incident.read`              | Which channels are configured (booleans and a reason, never a value)                      |
| `GET`/`PUT /alerts/settings?groupId=`                   | `alert.manage` (group level) | Switches per channel and the minimum severity (default SEV1 and SEV2)                     |
| `GET /alerts/contacts?groupId=`, `PUT /alerts/contacts` | `incident.read`              | Your own mobile in full, others masked; managers set anyone's; `{ mobile: null }` removes |
| `GET /alerts/deliveries`                                | `alert.manage`               | The outbox with status, attempts, last error                                              |
| `POST /alerts/test`                                     | `incident.read`              | A test alert to your own contact on a chosen channel (30 seconds between tests)           |

An incident opened or raised to SEV1 or SEV2 writes the deliveries in the same transaction; the sweep job `alerts` sends them (five attempts, back-off 1, 2, 4, 8 minutes, never twice); a final failure is audited and tells the holders of `alert.manage`.
Phone numbers live only in the database, **stored sealed** (AES-256-GCM through the secrets provider, purpose `alert_contact.mobile`; since 2026-11-27, migration `202611271000`), and never in logs, audit details or answers to other people. A row written before that holds the plain number, still opens, and is sealed the next time the number is saved. The format check (international form) is made by the API, not by the database.

### Responders, automatic assignment, claim (E-03, E-11, E-15)

| Method and path                               | Permission     | What                                                                                      |
| --------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------- |
| `GET /inbox/responders?companyId=`            | `inbox.read`   | The company's primary and backup responders with their languages                          |
| `PUT /inbox/responders`                       | `inbox.manage` | Replace one company's list (every person must hold `inbox.reply`); audited                |
| `GET /inbox/responders/candidates?companyId=` | `inbox.manage` | The people who may reply (for the picker)                                                 |
| `POST /inbox/claim`                           | `inbox.reply`  | `{ socialAccountId, engineMessageId }`: take an unassigned message; 409 if someone has it |

The sweep job `inbox-routing` gives every never-assigned, unanswered message of the last 7 days to the primary responder for its language (Ethiopic letters mean Amharic) with the fewest open messages, then any primary, then any other person who may reply;
with nobody available the managers are told once. It is not a reassignment and never moves the due time. At 150% the backup responders of the message's language are tried first.
The reports screen shows a month table of inbox and approval misses.

### Audit actions added in Round 3

`publication.removed` (`details.event` is `removed` or `engine_refused`), `publication.correction_requested`, `alert.sent`, `alert.failed`, `alert.contact_set`, `alert.settings_set`, `inbox.responder_set`, `inbox.auto_assigned`.

## Not built (still open)

Proof against a real Postiz that a published post is removed from the network; the real Teams, SMS and mail providers (only fake servers were used).
The inbox, approvals and incidents screens of Round 2 were walked in a real browser at 1280 and 360 px (13 defects fixed, axe 43 violations to 0, pull request 128). The removal, alerts and routing screens had their first real-browser pass after this page was written: see the QA entry in the backlog (R-09).

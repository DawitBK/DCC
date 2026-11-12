# Notifications: in-app inbox (first cut)

Owner: Hirko. **This is a first cut, not a decided design.** Who should be notified for each event,
and whether email/SMS is in scope, is Q4 in `portal/backend/QUESTIONS/QUESTIONS.md` (not part of the
repo, not yet answered by Dawit). Everything below is what is actually built today and will change
once Q4 is answered.

## What is built

In-app only - no email, no SMS, no Teams. A notification is one row per `(recipient, event)`, with a
personal read/unread flag. There is no "assignee" concept yet, so recipients are a **broadcast**:
everyone who held the relevant permission in the company at the moment the event happened (the same
model the placeholder approval rule already uses, see `docs/api/content.md`). The actor who caused the
event is never notified about their own action.

| Event               | Who is notified                                                          | Raised from                         |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| `content.submitted` | Everyone holding `content.review` in the company (not the submitter)     | `ApprovalsService.submit`           |
| `content.approved`  | The content item's creator only                                          | `ApprovalsService.decide` (approve) |
| `content.rejected`  | The content item's creator only                                          | `ApprovalsService.decide` (reject)  |
| `publishing.frozen` | Everyone holding `content.publish` in the company (not whoever froze it) | `FreezeService.freeze`              |
| `incident.opened`   | Everyone holding `incident.read` in the company (not whoever opened it)  | `IncidentsService.create`           |

A plain `review` (comment-only) decision does **not** notify anyone - only the two terminal outcomes
do.

## Endpoints

| Method | Path                              | Permission | Notes                                                                     |
| ------ | --------------------------------- | ---------- | ------------------------------------------------------------------------- |
| GET    | `/api/notifications`              | none       | Your own inbox only, newest first, max 200. `?unreadOnly=true` to filter. |
| GET    | `/api/notifications/unread-count` | none       | `{ unread }` for the bell badge.                                          |
| POST   | `/api/notifications/read-all`     | none       | Marks all your own unread notifications read; returns `{ marked }`.       |
| POST   | `/api/notifications/:id/read`     | none       | Marks one of your own notifications read. 404 if it is not yours.         |

No permission is required beyond being signed in: this is a personal inbox, not a company-scoped
list. What each person sees is restricted to their own `recipient_user_id` by row-level security, the
same way every other tenant table is restricted to a company - see
`docs/security/TENANCY-AND-RLS.md`.

Response shape: `NotificationDto[]`, each `{ id, companyId, eventType, targetType, targetId, summary,
readAt, createdAt }`. `targetType`/`targetId` point at the thing the notification is about (today
a `content_item`, a `publishing_freeze` or an `incident`), so the frontend can link to it.

## Not built yet

- Email/SMS delivery (proposal FR-16: Teams/SMS escalation for critical alerts) - needs a new
  dependency and Dawit's sign-off either way.
- A named "assignee" recipient instead of a broadcast - there is no assignee concept until the real
  approval routing (A-05) exists.
- Auto-escalation on a stale/overdue approval, or on an incident left open too long.

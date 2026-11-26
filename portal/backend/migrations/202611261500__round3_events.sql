-- Round 3 (2026-11-26): three more notification events (a published post removed, a correction asked for,
-- an alert that could not be delivered). Additive: every existing value stays allowed.
alter table notifications drop constraint notifications_event_type_check;
alter table notifications
  add constraint notifications_event_type_check
  check (event_type in (
    'content.submitted', 'content.approved', 'content.rejected',
    'publishing.frozen', 'incident.opened', 'inbox.assigned',
    'inbox.escalated', 'inbox.reply_requested', 'inbox.reply_decided',
    'approval.reminder', 'approval.escalated', 'approval.expired', 'approval.emergency', 'approval.followup_due',
    'incident.freeze_lift_requested', 'incident.freeze_lifted', 'incident.review_due', 'incident.review_overdue',
    'incident.closed',
    'publication.removed', 'publication.correction_requested', 'alert.delivery_failed'));

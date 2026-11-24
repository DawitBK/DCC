-- H-14 follow-up: assigning an inbox message tells the assignee (in-app). The list of notification events is a
-- database check, so it is widened by one value. Additive: no row changes, every existing value stays allowed.
-- The constraint name is the one PostgreSQL gave the inline check in 202611121000__notifications.sql.

alter table notifications drop constraint notifications_event_type_check;
alter table notifications
  add constraint notifications_event_type_check
  check (event_type in (
    'content.submitted', 'content.approved', 'content.rejected',
    'publishing.frozen', 'incident.opened', 'inbox.assigned'));

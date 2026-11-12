-- In-app notifications (H-06). Owner: Hirko.
--
-- First cut per Hirko's own suggested answer to Q4 (portal/backend/QUESTIONS/QUESTIONS.md - not yet
-- decided by Dawit): broadcast to everyone holding the relevant permission in the company (same
-- model the placeholder approval rule already uses), one row per (recipient, event) so read/unread
-- is personal. In-app only - no email/SMS, that needs a new dependency and Dawit's sign-off either
-- way (proposal FR-16, Release 2 / Medium priority).

create table notifications (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  recipient_user_id  uuid not null references users(id) on delete cascade,
  event_type         text not null check (event_type in (
                       'content.submitted', 'content.approved', 'content.rejected',
                       'publishing.frozen', 'incident.opened')),
  target_type        text not null,
  target_id          uuid not null,
  summary            text not null,
  read_at            timestamptz,
  created_at         timestamptz not null default now()
);

create index notifications_recipient_idx on notifications (recipient_user_id, created_at desc);

alter table notifications enable row level security;

-- A person sees (and may mark read) only their own notifications - this is a personal inbox, not a
-- company-scoped list, so it does not use app_company_allowed() for select the way other tables do.
create policy notifications_select on notifications for select using (
  recipient_user_id = app_user_id()
);
-- Inserted by the service that raised the event, acting for the company it already has access to -
-- the recipient is whoever currently holds the relevant permission, not necessarily the actor.
create policy notifications_insert on notifications for insert with check (
  app_company_allowed(company_id)
);
create policy notifications_update on notifications for update
  using (recipient_user_id = app_user_id())
  with check (recipient_user_id = app_user_id());

-- No delete: same soft-state convention as every other domain table.
grant select, insert, update on notifications to dcc_app;

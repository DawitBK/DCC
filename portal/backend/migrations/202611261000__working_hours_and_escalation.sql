-- Round 2 base (2026-11-26): the working-hours calendar, the escalation record, the sweep's company list,
-- and the full list of notification events the Round 2 features raise. Additive only.
--
--   company_working_hours  per company: working days, start and end of the day, UTC offset and public
--                          holidays (sheet C1-09, C1-10, E-12). No row = the default calendar in code
--                          (Monday to Saturday 08:30 to 17:30, UTC+3, no holidays: ASM-24).
--   escalation_events      one row per (kind, target, level) so an escalation notifies ONCE per level,
--                          however often the sweep or a screen asks (D-31).
--   sweep_company_ids()    the ids of the active companies, for the in-process sweep that has no signed-in
--                          person. Ids only: no names, no people.

create table company_working_hours (
  company_id          uuid primary key references companies(id),
  work_days           int[] not null default '{1,2,3,4,5,6}'
                        check (cardinality(work_days) between 1 and 7 and work_days <@ array[0,1,2,3,4,5,6]),
  start_minute        int not null default 510 check (start_minute between 0 and 1438),
  end_minute          int not null default 1050 check (end_minute between 1 and 1440),
  utc_offset_minutes  int not null default 180 check (utc_offset_minutes between -720 and 840),
  holidays            date[] not null default '{}',
  updated_by          uuid not null references users(id),
  updated_at          timestamptz not null default now(),
  check (end_minute > start_minute)
);

alter table company_working_hours enable row level security;
create policy company_working_hours_select on company_working_hours for select using (app_company_allowed(company_id));
create policy company_working_hours_insert on company_working_hours for insert with check (app_company_allowed(company_id));
create policy company_working_hours_update on company_working_hours for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));
grant select, insert, update on company_working_hours to dcc_app;

create table escalation_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  kind        text not null check (kind in ('inbox', 'approval', 'reply_approval', 'incident_review', 'emergency_followup')),
  target_id   uuid not null,
  level       int not null check (level between 1 and 6),
  created_at  timestamptz not null default now(),
  unique (kind, target_id, level)
);
create index escalation_events_company_idx on escalation_events (company_id, created_at desc);

alter table escalation_events enable row level security;
create policy escalation_events_select on escalation_events for select using (app_company_allowed(company_id));
create policy escalation_events_insert on escalation_events for insert with check (app_company_allowed(company_id));
grant select, insert on escalation_events to dcc_app;

create function sweep_company_ids() returns table (company_id uuid)
  language sql stable security definer set search_path = public, pg_temp
  as $$ select id from companies where status = 'active' $$;
revoke all on function sweep_company_ids() from public;
grant execute on function sweep_company_ids() to dcc_app;

alter table notifications drop constraint notifications_event_type_check;
alter table notifications
  add constraint notifications_event_type_check
  check (event_type in (
    'content.submitted', 'content.approved', 'content.rejected',
    'publishing.frozen', 'incident.opened', 'inbox.assigned',
    'inbox.escalated', 'inbox.reply_requested', 'inbox.reply_decided',
    'approval.reminder', 'approval.escalated', 'approval.expired', 'approval.emergency', 'approval.followup_due',
    'incident.freeze_lift_requested', 'incident.freeze_lifted', 'incident.review_due', 'incident.review_overdue',
    'incident.closed'));

-- Round 2, inbox clock (2026-11-26): priority, working-hours response targets and escalation of inbox messages.
-- Additive only. Sheet E (E-04 to E-07, E-12): urgent 1 hour, normal 4 working hours, low 24 hours; a reassignment
-- never restarts the clock; after two reassignments the message goes to the Digital Marketing Manager.
--
--   inbox_settings.*_target_minutes   the three targets per company (defaults 60 / 240 / 1440, stored).
--                                     response_target_minutes is kept and now mirrors the normal target, so what it
--                                     meant ("the" target) keeps its meaning; the backfill copies it to the normal target.
--   inbox_settings.urgent_round_the_clock
--                                     ASSUMPTION: urgent counts 1 WORKING hour; flipping this to true counts it round the clock.
--   inbox_items.priority              urgent | normal | low, who set it and when (a person decides; there is no keyword AI).
--   inbox_items.reassignment_count    how many times a person handed the message on (a system move is not counted).
--   inbox_items.first_assigned_at     when a person first assigned it (so clear-and-assign cannot dodge the count).
--   inbox_items.needs_manager         set once at the second reassignment.
--
-- inbox_items is no longer only "touched" messages: the sweep adds a row (id and received time, never text) for every
-- unanswered message of the last 7 days, so a message nobody opens still escalates.
-- No new table, so no new policy: the existing row-level policies of both tables cover the new columns.

alter table inbox_settings
  add column urgent_target_minutes int not null default 60
    check (urgent_target_minutes between 1 and 43200),
  add column normal_target_minutes int not null default 240
    check (normal_target_minutes between 1 and 43200),
  add column low_target_minutes int not null default 1440
    check (low_target_minutes between 1 and 43200),
  add column urgent_round_the_clock boolean not null default false;

update inbox_settings set normal_target_minutes = response_target_minutes where response_target_minutes is not null;

alter table inbox_items
  add column priority text not null default 'normal' check (priority in ('urgent', 'normal', 'low')),
  add column priority_set_by uuid references users(id),
  add column priority_set_at timestamptz,
  add column reassignment_count int not null default 0 check (reassignment_count >= 0),
  add column first_assigned_at timestamptz,
  add column needs_manager boolean not null default false,
  add column needs_manager_at timestamptz,
  add constraint inbox_items_priority_set_together check ((priority_set_by is null) = (priority_set_at is null));

update inbox_items set first_assigned_at = assigned_at where assigned_at is not null;

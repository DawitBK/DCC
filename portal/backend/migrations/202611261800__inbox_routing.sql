-- Round 3, routing (2026-11-26): responders per company and language, and automatic assignment of inbox messages
-- (sheet E-03, E-11, E-15; B-37). Additive only.
--
--   inbox_responders                    who answers the inbox of a company: a primary or a backup responder, and in which
--                                       language(s) (en, am). Many per company; one row per person and company. The person
--                                       must hold inbox.reply (the service checks it on every write and ignores a responder
--                                       who lost it; the database cannot see roles).
--   inbox_items.assigned_automatically  true while the message is held by an assignment the SYSTEM made (the routing sweep
--                                       or the 150% backup move); any person assigning or claiming it sets it back to false.
-- The assignment itself reuses the existing columns: assigned_to, assigned_at, assigned_by (null for the system).

create table inbox_responders (
  company_id  uuid not null references companies(id),
  user_id     uuid not null references users(id),
  kind        text not null check (kind in ('primary', 'backup')),
  languages   text[] not null
                check (cardinality(languages) between 1 and 2
                       and languages <@ array['en', 'am']
                       and (cardinality(languages) = 1 or languages[1] <> languages[2])),
  updated_by  uuid not null references users(id),
  updated_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);

alter table inbox_responders enable row level security;
create policy inbox_responders_select on inbox_responders for select using (app_company_allowed(company_id));
create policy inbox_responders_insert on inbox_responders for insert with check (app_company_allowed(company_id));
create policy inbox_responders_update on inbox_responders for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));
-- Replacing the list removes the people who are no longer in it; the audit event keeps the before and after.
create policy inbox_responders_delete on inbox_responders for delete using (app_company_allowed(company_id));
grant select, insert, update, delete on inbox_responders to dcc_app;

alter table inbox_items add column assigned_automatically boolean not null default false;

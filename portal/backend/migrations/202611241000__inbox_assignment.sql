-- Inbox assignment and response-time tracking (H-14). Additive only.
--
-- The inbox itself stays in the operational engine: DCC stores no message text. What DCC owns is the work
-- around a message: who it is assigned to, and when the first reply went out through DCC. One row per
-- message that has been assigned or answered through DCC (created on first use, never for every message).
--
--   inbox_items     assignee, and the time of the first reply sent through DCC. The message time is copied
--                   when the row is created so the response time survives the engine's own retention.
--   inbox_settings  per company: the response-time target in minutes. NULL (or no row) means no target.
--                   There is deliberately no default: the numbers come from the marketing lead (A-07).

create table inbox_items (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  social_account_id  uuid not null,
  engine_message_id  text not null check (length(engine_message_id) between 1 and 200),
  received_at        timestamptz not null,
  assigned_to        uuid references users(id),
  assigned_by        uuid references users(id),
  assigned_at        timestamptz,
  first_response_at  timestamptz,
  first_response_by  uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (social_account_id, engine_message_id),
  foreign key (social_account_id, company_id) references social_accounts(id, company_id),
  check ((assigned_to is null) = (assigned_at is null)),
  check ((first_response_at is null) = (first_response_by is null))
);
create index inbox_items_company_assignee_idx on inbox_items (company_id, assigned_to);

create table inbox_settings (
  company_id               uuid primary key references companies(id),
  response_target_minutes  int check (response_target_minutes between 1 and 43200),
  updated_by               uuid not null references users(id),
  updated_at               timestamptz not null default now()
);

alter table inbox_items    enable row level security;
alter table inbox_settings enable row level security;

create policy inbox_items_select on inbox_items for select using (app_company_allowed(company_id));
create policy inbox_items_insert on inbox_items for insert with check (app_company_allowed(company_id));
create policy inbox_items_update on inbox_items for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));

create policy inbox_settings_select on inbox_settings for select using (app_company_allowed(company_id));
create policy inbox_settings_insert on inbox_settings for insert with check (app_company_allowed(company_id));
create policy inbox_settings_update on inbox_settings for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));

-- No DELETE on either: an assignment is cleared by setting assigned_to to null, a target by setting it to null.
grant select, insert, update on inbox_items to dcc_app;
grant select, insert, update on inbox_settings to dcc_app;

-- Incident detail (H-06): the STRUCTURE for categories, playbooks and recovery contacts. Owner: Dawit.
--
-- The text of section 4B of the team document is not in this repository and is not invented here: every table starts
-- EMPTY and nothing is seeded. What is stored is entered by the Group through the API (docs/api/incidents.md,
-- decision D-27 in docs/project/OPEN-DECISIONS.md).
--
--   incident_categories         a company's own list of kinds of incident, or (company_id null) the Group's default
--                               list offered to every company of that group. A category may carry ONE optional
--                               playbook: a title and an ordered list of plain-text steps. No playbook by default.
--   incident_recovery_contacts  per company: people to call when something goes wrong. They need no DCC account;
--                               a contact has a name, a role label and one channel (email, phone or other) with
--                               its value. Archived, never deleted.
--   incidents.category_id       an incident may point at a category (additive, nullable).

create table incident_categories (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references groups(id),
  company_id      uuid references companies(id),
  key             text not null check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(key) between 2 and 64),
  name            text not null check (length(btrim(name)) between 2 and 120),
  status          text not null default 'active' check (status in ('active', 'archived')),
  playbook_title  text check (length(btrim(playbook_title)) between 2 and 200),
  playbook_steps  text[] not null default '{}',
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- No playbook (no title, no steps) or a complete one (a title and 1 to 30 steps of limited size).
  check (
    (playbook_title is null and cardinality(playbook_steps) = 0)
    or (playbook_title is not null and cardinality(playbook_steps) between 1 and 30
        and length(array_to_string(playbook_steps, E'\n')) <= 16000)
  )
);
create unique index incident_categories_key
  on incident_categories (group_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create table incident_recovery_contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  name        text not null check (length(btrim(name)) between 2 and 120),
  role_label  text not null check (length(btrim(role_label)) between 2 and 120),
  channel     text not null check (channel in ('email', 'phone', 'other')),
  value       text not null check (length(btrim(value)) between 1 and 200),
  position    int not null default 0 check (position between 0 and 1000),
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index incident_recovery_contacts_company_idx on incident_recovery_contacts (company_id, status, position);

alter table incidents add column category_id uuid references incident_categories(id);

alter table incident_categories         enable row level security;
alter table incident_recovery_contacts  enable row level security;

-- A company's own category: whoever may touch that company, and the row's group must be the company's group.
-- The group's default category (company_id null): readable by everyone working in the group, written only by a
-- group-level role of that group.
create policy incident_categories_select on incident_categories for select using (
  (company_id is not null and app_company_allowed(company_id))
  or (company_id is null and (
        group_id = any(app_group_ids())
        or exists (select 1 from companies c where c.group_id = incident_categories.group_id and c.id = any(app_company_ids()))
     ))
);
create policy incident_categories_insert on incident_categories for insert with check (
  (company_id is not null and app_company_allowed(company_id)
     and exists (select 1 from companies c where c.id = incident_categories.company_id and c.group_id = incident_categories.group_id))
  or (company_id is null and group_id = any(app_group_ids()))
);
create policy incident_categories_update on incident_categories for update using (
  (company_id is not null and app_company_allowed(company_id))
  or (company_id is null and group_id = any(app_group_ids()))
) with check (
  (company_id is not null and app_company_allowed(company_id)
     and exists (select 1 from companies c where c.id = incident_categories.company_id and c.group_id = incident_categories.group_id))
  or (company_id is null and group_id = any(app_group_ids()))
);

create policy incident_recovery_contacts_select on incident_recovery_contacts for select using (app_company_allowed(company_id));
create policy incident_recovery_contacts_insert on incident_recovery_contacts for insert with check (app_company_allowed(company_id));
create policy incident_recovery_contacts_update on incident_recovery_contacts for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));

-- No DELETE on either: archived, same convention as every other domain table.
grant select, insert, update on incident_categories to dcc_app;
grant select, insert, update on incident_recovery_contacts to dcc_app;

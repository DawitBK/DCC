-- Approval policy as data (H-09). Owner: Hirko's area; written by the architect on 2026-11-14.
--
-- WHY: who must approve what is a business rule that will change when the signed approval matrix arrives
-- (A-05) and again afterwards. It must be changed on a screen by an administrator, never in code.
--
--   content_categories   the Group's own list of kinds of content (announcement, campaign, crisis ...).
--   approval_policies    per company: for a category (or, with category_id null, for everything else),
--                        how many different people must approve and which roles may approve.
--   approval_requests    remembers the rule it was opened under, so changing a policy never changes the
--                        outcome of a request that is already waiting.
--
-- With no policy at all the rule stays what it was: one approver, any role that may approve.
-- Always on top, and not configurable: nobody who wrote any version of an item may decide on it.

create table content_categories (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id),
  key         text not null check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(key) between 2 and 64),
  name        text not null check (length(btrim(name)) between 2 and 120),
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_at  timestamptz not null default now(),
  unique (group_id, key)
);

alter table content_items add column category_id uuid references content_categories(id);

create table approval_policies (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  category_id         uuid references content_categories(id),
  required_approvals  int not null default 1 check (required_approvals between 1 and 5),
  -- Empty = any role that holds the approve permission. Otherwise only these roles may approve or reject.
  approver_roles      text[] not null default '{}',
  updated_by          uuid not null references users(id),
  updated_at          timestamptz not null default now()
);
create unique index approval_policies_company_default_key on approval_policies (company_id) where category_id is null;
create unique index approval_policies_company_category_key on approval_policies (company_id, category_id) where category_id is not null;

alter table approval_requests
  add column required_approvals int not null default 1 check (required_approvals between 1 and 5),
  add column approver_roles text[] not null default '{}';

alter table content_categories enable row level security;
alter table approval_policies  enable row level security;

-- Categories belong to the group: everyone working in one of the group's companies may read them,
-- only a group-level role may write them.
create policy content_categories_select on content_categories for select using (
  group_id = any(app_group_ids())
  or exists (select 1 from companies c where c.group_id = content_categories.group_id and c.id = any(app_company_ids()))
);
create policy content_categories_insert on content_categories for insert with check (group_id = any(app_group_ids()));
create policy content_categories_update on content_categories for update
  using (group_id = any(app_group_ids())) with check (group_id = any(app_group_ids()));

create policy approval_policies_select on approval_policies for select using (app_company_allowed(company_id));
create policy approval_policies_insert on approval_policies for insert with check (app_company_allowed(company_id));
create policy approval_policies_update on approval_policies for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));
create policy approval_policies_delete on approval_policies for delete using (app_company_allowed(company_id));

grant select, insert, update on content_categories to dcc_app;
grant select, insert, update, delete on approval_policies to dcc_app;

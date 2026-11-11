-- Content, versions and approvals (H-04). Owner: Hirko.
--
-- Shape: a content item has one or more immutable versions (every edit makes a new version); a
-- version that is submitted gets exactly one approval request; a request accumulates a history of
-- decisions (comments and the one terminal approve/reject). The review-vs-approve split matches the
-- proposal's own process walkthrough (plan review note H-04/H-06): review is a comment with no
-- decision yet, approve/reject is terminal.
--
-- The category/level-based approval ROUTING (who must approve what) is Abenezer's A-05, not yet
-- closed. Nothing here hard-codes it: approval_requests/approval_decisions only record what
-- happened, not the rule for who may decide - that rule lives in the service (today: one reviewer
-- who is not the creator), designed to be replaced without a migration.

create table content_items (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  brand_id            uuid,
  created_by          uuid not null references users(id),
  -- Added once content_versions exists (below): the latest version, or null before the first one.
  current_version_id  uuid,
  status              text not null default 'draft'
                        check (status in ('draft', 'in_review', 'approved', 'rejected', 'published', 'archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, company_id),
  foreign key (brand_id, company_id) references brands(id, company_id)
);

-- Immutable once created: an edit is a new row, never a change to an existing one.
create table content_versions (
  id                uuid primary key default gen_random_uuid(),
  content_item_id   uuid not null,
  company_id        uuid not null,
  version_number    int not null check (version_number > 0),
  body              text not null,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  unique (content_item_id, version_number),
  unique (id, company_id),
  foreign key (content_item_id, company_id) references content_items(id, company_id)
);

alter table content_items
  add constraint content_items_current_version_fkey
  foreign key (current_version_id, company_id) references content_versions(id, company_id);

-- Which social accounts a version is meant for. A version's targets are fixed at creation.
create table content_version_targets (
  id                  uuid primary key default gen_random_uuid(),
  content_version_id  uuid not null,
  company_id          uuid not null,
  social_account_id   uuid not null,
  unique (content_version_id, social_account_id),
  foreign key (content_version_id, company_id) references content_versions(id, company_id),
  foreign key (social_account_id, company_id) references social_accounts(id, company_id)
);

-- At most one request per version (H-04 step 6: "a new version needs a new approval" - a rejected
-- or still-pending version never silently reuses another version's request).
create table approval_requests (
  id                  uuid primary key default gen_random_uuid(),
  content_version_id  uuid not null unique,
  company_id          uuid not null,
  requested_by        uuid not null references users(id),
  requested_at        timestamptz not null default now(),
  status              text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  unique (id, company_id),
  foreign key (content_version_id, company_id) references content_versions(id, company_id)
);

-- The history on a request: zero or more comments, then exactly one terminal approve/reject
-- (enforced by the service, not here - the table itself just records what happened, append-only).
create table approval_decisions (
  id                  uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null,
  company_id          uuid not null,
  decided_by          uuid not null references users(id),
  decision            text not null check (decision in ('commented', 'approved', 'rejected')),
  comment             text,
  decided_at          timestamptz not null default now(),
  foreign key (approval_request_id, company_id) references approval_requests(id, company_id)
);

alter table content_items             enable row level security;
alter table content_versions          enable row level security;
alter table content_version_targets   enable row level security;
alter table approval_requests         enable row level security;
alter table approval_decisions        enable row level security;

create policy content_items_select on content_items for select using (app_company_allowed(company_id));
create policy content_items_insert on content_items for insert with check (app_company_allowed(company_id));
create policy content_items_update on content_items for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));

create policy content_versions_select on content_versions for select using (app_company_allowed(company_id));
create policy content_versions_insert on content_versions for insert with check (app_company_allowed(company_id));

create policy content_version_targets_select on content_version_targets for select using (app_company_allowed(company_id));
create policy content_version_targets_insert on content_version_targets for insert with check (app_company_allowed(company_id));

create policy approval_requests_select on approval_requests for select using (app_company_allowed(company_id));
create policy approval_requests_insert on approval_requests for insert with check (app_company_allowed(company_id));
create policy approval_requests_update on approval_requests for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));

create policy approval_decisions_select on approval_decisions for select using (app_company_allowed(company_id));
create policy approval_decisions_insert on approval_decisions for insert with check (app_company_allowed(company_id));

-- Least privilege: no DELETE anywhere here, same as companies/brands/social_accounts (soft state by
-- status, never deletion). Versions and decisions are never updated either: they are immutable.
grant select, insert, update on content_items, approval_requests to dcc_app;
grant select, insert on content_versions, content_version_targets, approval_decisions to dcc_app;

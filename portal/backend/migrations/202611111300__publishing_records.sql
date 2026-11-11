-- Publishing records, the idempotency store, and the freeze switch (H-05). Owner: Hirko.
--
-- publications is a durable, readable history: one row per distinct publish attempt
-- (content item + version + target channel), upserted on its idempotency_key so a double-click
-- never produces two rows. idempotency_keys is the separate, internal technical store
-- GovernedEngine itself relies on (portal/engine-client/src/governed.ts): no RLS, same as
-- sessions/auth_transactions, since IdempotencyStore's interface carries no company context to
-- scope by - it is never read through TenantDb or exposed by any endpoint.

create table publications (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  content_item_id     uuid not null,
  content_version_id  uuid not null,
  social_account_id   uuid not null,
  requested_by        uuid not null references users(id),
  approved_by         uuid references users(id),
  idempotency_key     text not null unique,
  engine_operation_id text,
  external_post_url   text,
  status              text not null default 'pending' check (status in ('pending', 'published', 'failed')),
  error               text,
  requested_at        timestamptz not null default now(),
  completed_at        timestamptz,
  unique (id, company_id),
  foreign key (content_item_id, company_id) references content_items(id, company_id),
  foreign key (content_version_id, company_id) references content_versions(id, company_id),
  foreign key (social_account_id, company_id) references social_accounts(id, company_id)
);

create table idempotency_keys (
  key         text primary key,
  state       text not null check (state in ('in_progress', 'done', 'unknown')),
  result      jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- FR-15: freeze publishing per company (social_account_id null) or per specific account. The check
-- joins live to social_accounts.engine_channel_id (FreezeCheck's interface takes the engine's own
-- channel id) rather than denormalizing it here, so a freeze stays correct even if an account is
-- reconnected to the engine under a different channel id later.
create table publishing_freezes (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  social_account_id  uuid,
  frozen_by          uuid not null references users(id),
  reason             text,
  frozen_at          timestamptz not null default now(),
  foreign key (social_account_id, company_id) references social_accounts(id, company_id)
);
create unique index publishing_freezes_company_key on publishing_freezes (company_id) where social_account_id is null;
create unique index publishing_freezes_account_key on publishing_freezes (company_id, social_account_id) where social_account_id is not null;

alter table publications        enable row level security;
alter table publishing_freezes  enable row level security;

create policy publications_select on publications for select using (app_company_allowed(company_id));
create policy publications_insert on publications for insert with check (app_company_allowed(company_id));
create policy publications_update on publications for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));

create policy publishing_freezes_select on publishing_freezes for select using (app_company_allowed(company_id));
create policy publishing_freezes_insert on publishing_freezes for insert with check (app_company_allowed(company_id));
create policy publishing_freezes_delete on publishing_freezes for delete using (app_company_allowed(company_id));

grant select, insert, update on publications to dcc_app;
grant select, insert, delete on publishing_freezes to dcc_app;
-- idempotency_keys has no RLS (a system table, not tenant data): delete is needed for release().
grant select, insert, update, delete on idempotency_keys to dcc_app;

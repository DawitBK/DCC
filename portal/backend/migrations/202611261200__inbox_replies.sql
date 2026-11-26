-- Round 2, builder "replies" (2026-11-26): approval of sensitive replies (E-08), moderation of comments (E-14) and the
-- automatic acknowledgement outside working hours (E-13). Additive only: five new tables.
--
--   reply_approval_requests    a sensitive reply that is NOT sent until enough different approvers agree. It stores the
--                              text, the message id, the kind and who wrote it; the rule (approvals needed, roles) is
--                              copied when it is asked, so a later policy change never moves a waiting request.
--                              Status: pending -> approved (enough approvals, being sent) -> sent or failed; or rejected.
--   reply_approval_decisions   one row per approver and request (approved or rejected, with a comment).
--   inbox_moderation_actions   who hid, deleted or blocked what, why, and what really happened in the network.
--   inbox_ack_settings         per company: the acknowledgement texts and who approved EXACTLY that text. An edit
--                              clears the approval (done in the service; the check below forbids approving your own text).
--   inbox_acknowledgements     one row per message that was (or is being) acknowledged: the claim that makes sure
--                              an acknowledgement is never sent twice. It is NOT the first response of the response clock.

create table reply_approval_requests (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  social_account_id  uuid not null,
  engine_message_id  text not null check (length(engine_message_id) between 1 and 200),
  kind               text not null check (kind in ('legal_threat', 'media', 'investor', 'safety', 'personal_data', 'refund_compensation')),
  text               text not null check (length(text) between 1 and 2000),
  written_by         uuid not null references users(id),
  requested_at       timestamptz not null default now(),
  status             text not null default 'pending' check (status in ('pending', 'approved', 'sent', 'rejected', 'failed')),
  required_approvals int not null default 1 check (required_approvals between 1 and 10),
  approver_roles     text[] not null default '{}',
  category_key       text not null,
  due_at             timestamptz not null,
  settled_at         timestamptz,
  settled_reason     text check (settled_reason is null or length(settled_reason) <= 1000),
  foreign key (social_account_id, company_id) references social_accounts(id, company_id),
  check ((status in ('pending', 'approved')) = (settled_at is null))
);
-- One open request per message: a second one for the same message is a conflict, not a second chance to be approved.
create unique index reply_approval_open_per_message
  on reply_approval_requests (social_account_id, engine_message_id) where status in ('pending', 'approved');
create index reply_approval_requests_company_idx on reply_approval_requests (company_id, status, requested_at);

create table reply_approval_decisions (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references reply_approval_requests(id),
  company_id  uuid not null references companies(id),
  decided_by  uuid not null references users(id),
  decision    text not null check (decision in ('approved', 'rejected')),
  comment     text check (comment is null or length(comment) <= 1000),
  decided_at  timestamptz not null default now(),
  unique (request_id, decided_by)
);

create table inbox_moderation_actions (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  social_account_id  uuid not null,
  engine_message_id  text not null check (length(engine_message_id) between 1 and 200),
  action             text not null check (action in ('hide', 'delete', 'block')),
  reason             text check (reason is null or length(reason) <= 500),
  outcome            text not null check (outcome in ('done', 'recorded_only', 'failed')),
  outcome_detail     text check (outcome_detail is null or length(outcome_detail) <= 500),
  performed_by       uuid not null references users(id),
  performed_at       timestamptz not null default now(),
  foreign key (social_account_id, company_id) references social_accounts(id, company_id),
  -- Deleting and blocking cannot be undone: the reason is mandatory (the service says so in words first).
  check (action = 'hide' or (reason is not null and length(reason) >= 5))
);
create index inbox_moderation_actions_company_idx on inbox_moderation_actions (company_id, performed_at desc);

create table inbox_ack_settings (
  company_id   uuid primary key references companies(id),
  text_en      text not null check (length(text_en) between 1 and 500),
  text_am      text check (text_am is null or length(text_am) between 1 and 500),
  enabled      boolean not null default true,
  version      int not null default 1,
  set_by       uuid not null references users(id),
  set_at       timestamptz not null default now(),
  approved_by  uuid references users(id),
  approved_at  timestamptz,
  check ((approved_by is null) = (approved_at is null)),
  -- The person who wrote the text can never be the one who approves it.
  check (approved_by is null or approved_by <> set_by)
);

create table inbox_acknowledgements (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  social_account_id  uuid not null,
  engine_message_id  text not null check (length(engine_message_id) between 1 and 200),
  received_at        timestamptz not null,
  language           text not null check (language in ('en', 'am')),
  claimed_at         timestamptz not null default now(),
  acked_at           timestamptz,
  unique (social_account_id, engine_message_id),
  foreign key (social_account_id, company_id) references social_accounts(id, company_id)
);

alter table reply_approval_requests  enable row level security;
alter table reply_approval_decisions enable row level security;
alter table inbox_moderation_actions enable row level security;
alter table inbox_ack_settings       enable row level security;
alter table inbox_acknowledgements   enable row level security;

create policy reply_approval_requests_select on reply_approval_requests for select using (app_company_allowed(company_id));
create policy reply_approval_requests_insert on reply_approval_requests for insert with check (app_company_allowed(company_id));
create policy reply_approval_requests_update on reply_approval_requests for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));

create policy reply_approval_decisions_select on reply_approval_decisions for select using (app_company_allowed(company_id));
create policy reply_approval_decisions_insert on reply_approval_decisions for insert with check (app_company_allowed(company_id));

create policy inbox_moderation_actions_select on inbox_moderation_actions for select using (app_company_allowed(company_id));
create policy inbox_moderation_actions_insert on inbox_moderation_actions for insert with check (app_company_allowed(company_id));

create policy inbox_ack_settings_select on inbox_ack_settings for select using (app_company_allowed(company_id));
create policy inbox_ack_settings_insert on inbox_ack_settings for insert with check (app_company_allowed(company_id));
create policy inbox_ack_settings_update on inbox_ack_settings for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));

create policy inbox_acknowledgements_select on inbox_acknowledgements for select using (app_company_allowed(company_id));
create policy inbox_acknowledgements_insert on inbox_acknowledgements for insert with check (app_company_allowed(company_id));
create policy inbox_acknowledgements_update on inbox_acknowledgements for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));
-- Only an UNSENT claim may be released (a failed send is tried again by the next sweep); a sent record stays for good.
create policy inbox_acknowledgements_delete on inbox_acknowledgements for delete
  using (app_company_allowed(company_id) and acked_at is null);

-- Minimal grants. A request and its decisions are history: nothing is deleted. Moderation is an append-only record.
grant select, insert, update on reply_approval_requests to dcc_app;
grant select, insert on reply_approval_decisions to dcc_app;
grant select, insert on inbox_moderation_actions to dcc_app;
grant select, insert, update on inbox_ack_settings to dcc_app;
grant select, insert, update, delete on inbox_acknowledgements to dcc_app;

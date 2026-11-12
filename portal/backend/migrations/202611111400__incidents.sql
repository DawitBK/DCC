-- Incidents (H-06). Owner: Hirko.
--
-- "Register, escalate, track and resolve incidents; recovery checklists and contacts" (proposal
-- §7.1, module 10). The detailed incident taxonomy (categories, severities, playbooks) is in
-- section 4B of the confidential team document, which is not available here: this is a first,
-- minimal cut covering what the proposal itself describes, not a guess at business rules the
-- document might add. Easy to extend with a later migration once 4B is read.

create table incidents (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  social_account_id  uuid,
  title              text not null,
  description        text,
  severity           text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status             text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'closed')),
  opened_by          uuid not null references users(id),
  opened_at          timestamptz not null default now(),
  resolved_at        timestamptz,
  unique (id, company_id),
  foreign key (social_account_id, company_id) references social_accounts(id, company_id)
);

alter table incidents enable row level security;

create policy incidents_select on incidents for select using (app_company_allowed(company_id));
create policy incidents_insert on incidents for insert with check (app_company_allowed(company_id));
create policy incidents_update on incidents for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));

-- No DELETE: soft state by status, same as every other domain table.
grant select, insert, update on incidents to dcc_app;

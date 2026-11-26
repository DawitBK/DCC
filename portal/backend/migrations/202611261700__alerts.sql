-- Round 3, alerts (sheet D2-19, D2-20, D2-22; RQ-029). Additive only.
--
-- A SEV1 or SEV2 incident (severity critical or high) is announced by SMS, Microsoft Teams and e-mail. The channels'
-- addresses and secrets are environment variables, never rows. What is stored here:
--
--   alert_settings            per GROUP: which channels are switched on, and the lowest severity that alerts. No row =
--                             the defaults in code (all three on, SEV1 and SEV2).
--   alert_contacts            per GROUP and person: the mobile number for SMS. Real numbers live ONLY here; the API
--                             masks them for everyone but the person and the alert managers; audit and logs never carry them.
--   alert_deliveries          the OUTBOX: one row per message to send (channel, who, text, status, attempts, last error,
--                             next attempt time). Written in the SAME transaction as the incident, so a rolled-back
--                             incident leaves no alert behind. No phone number is stored: the SMS sweep reads the
--                             contact at send time.
--   alert_incident_dispatches which severity of which incident was already announced (rank 2 = high/SEV2, 3 = critical/SEV1).
--                             An incident alerts when it reaches a severity above everything announced so far, so
--                             lowering and raising again never repeats an alert, and any code path that opens an
--                             incident (the bypass check does) is covered by the sweep.
--   alert_recipients()        the people to alert, with their account e-mail (see below).

create table alert_settings (
  group_id       uuid primary key references groups(id),
  sms_enabled    boolean not null default true,
  teams_enabled  boolean not null default true,
  email_enabled  boolean not null default true,
  min_severity   text not null default 'high' check (min_severity in ('critical', 'high')),
  updated_by     uuid not null references users(id),
  updated_at     timestamptz not null default now()
);

create table alert_contacts (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id),
  user_id     uuid not null references users(id),
  mobile      text not null check (mobile ~ '^\+[1-9][0-9]{7,14}$'),
  updated_by  uuid not null references users(id),
  updated_at  timestamptz not null default now(),
  unique (group_id, user_id)
);

create table alert_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  group_id           uuid not null references groups(id),
  incident_id        uuid not null,
  channel            text not null check (channel in ('sms', 'teams', 'email')),
  recipient_user_id  uuid references users(id),
  severity           text not null check (severity in ('critical', 'high')),
  subject            text not null check (length(subject) between 1 and 300),
  body               text not null check (length(body) between 1 and 4000),
  status             text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts           int not null default 0 check (attempts between 0 and 5),
  last_error         text check (last_error is null or length(last_error) <= 300),
  next_attempt_at    timestamptz not null default now(),
  sent_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (incident_id, company_id) references incidents(id, company_id),
  -- A Teams message goes to the channel, every other message to one person.
  check ((channel = 'teams') = (recipient_user_id is null))
);
create index alert_deliveries_due_idx on alert_deliveries (company_id, next_attempt_at) where status = 'pending';
create index alert_deliveries_company_idx on alert_deliveries (company_id, created_at desc);
create index alert_deliveries_incident_idx on alert_deliveries (incident_id);

create table alert_incident_dispatches (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id),
  incident_id    uuid not null,
  severity_rank  smallint not null check (severity_rank in (2, 3)),
  created_at     timestamptz not null default now(),
  unique (incident_id, severity_rank),
  foreign key (incident_id, company_id) references incidents(id, company_id)
);

-- Incidents that are already SEV1 or SEV2 today were not announced by this feature and must not be announced now.
insert into alert_incident_dispatches (company_id, incident_id, severity_rank)
select company_id, id, case severity when 'critical' then 3 else 2 end
  from incidents where severity in ('high', 'critical');

alter table alert_settings            enable row level security;
alter table alert_contacts            enable row level security;
alter table alert_deliveries          enable row level security;
alter table alert_incident_dispatches enable row level security;

-- Group-scoped tables: readable by everyone working in the group (a group-level role, or a company of the group),
-- written by a group-level role of that group. A person may also keep their OWN contact from a company-level seat.
create policy alert_settings_select on alert_settings for select using (
  group_id = any(app_group_ids())
  or exists (select 1 from companies c where c.group_id = alert_settings.group_id and c.id = any(app_company_ids()))
);
create policy alert_settings_insert on alert_settings for insert with check (group_id = any(app_group_ids()));
create policy alert_settings_update on alert_settings for update
  using (group_id = any(app_group_ids())) with check (group_id = any(app_group_ids()));

create policy alert_contacts_select on alert_contacts for select using (
  group_id = any(app_group_ids())
  or exists (select 1 from companies c where c.group_id = alert_contacts.group_id and c.id = any(app_company_ids()))
);
create policy alert_contacts_insert on alert_contacts for insert with check (
  group_id = any(app_group_ids())
  or (user_id = app_user_id()
      and exists (select 1 from companies c where c.group_id = alert_contacts.group_id and c.id = any(app_company_ids())))
);
create policy alert_contacts_update on alert_contacts for update
  using (
    group_id = any(app_group_ids())
    or (user_id = app_user_id()
        and exists (select 1 from companies c where c.group_id = alert_contacts.group_id and c.id = any(app_company_ids())))
  )
  with check (
    group_id = any(app_group_ids())
    or (user_id = app_user_id()
        and exists (select 1 from companies c where c.group_id = alert_contacts.group_id and c.id = any(app_company_ids())))
  );
create policy alert_contacts_delete on alert_contacts for delete using (
  group_id = any(app_group_ids())
  or (user_id = app_user_id()
      and exists (select 1 from companies c where c.group_id = alert_contacts.group_id and c.id = any(app_company_ids())))
);

create policy alert_deliveries_select on alert_deliveries for select using (app_company_allowed(company_id));
create policy alert_deliveries_insert on alert_deliveries for insert with check (app_company_allowed(company_id));
create policy alert_deliveries_update on alert_deliveries for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));

create policy alert_incident_dispatches_select on alert_incident_dispatches for select using (app_company_allowed(company_id));
create policy alert_incident_dispatches_insert on alert_incident_dispatches for insert with check (app_company_allowed(company_id));

grant select, insert, update on alert_settings to dcc_app;
grant select, insert, update, delete on alert_contacts to dcc_app;
-- No DELETE on the outbox: a delivery and its outcome stay on record.
grant select, insert, update on alert_deliveries to dcc_app;
grant select, insert on alert_incident_dispatches to dcc_app;

-- Who must be alerted, with the address to alert them at. Same reasoning as notification_recipients (2026-11-13): row-level
-- security hides group-level people (and their user rows) from a company-level caller and from the sweep, so a plain query
-- would silently skip the Group CTO. This narrow SECURITY DEFINER function:
--   * returns nothing unless the caller may already touch that company;
--   * returns active people of that company and of that company's own group only, never another group's;
--   * picks them by role (p_roles) and/or by id (p_user_ids, for example the incident owner), and ONLY if they belong;
--   * returns the account e-mail and display name for the alert text and the e-mail channel; the API never returns an e-mail.
create function alert_recipients(p_company_id uuid, p_roles text[], p_user_ids uuid[])
  returns table (user_id uuid, email text, display_name text)
  language sql stable security definer set search_path = public, pg_temp
  as $$
    select distinct u.id, u.email, u.display_name
      from users u
      join memberships m on m.user_id = u.id
      join companies c on c.id = p_company_id
     where u.status = 'active'
       and app_company_allowed(p_company_id)
       and (m.company_id = p_company_id or (m.company_id is null and m.group_id = c.group_id))
       and (m.role = any(p_roles) or u.id = any(p_user_ids))
  $$;
revoke all on function alert_recipients(uuid, text[], uuid[]) from public;
grant execute on function alert_recipients(uuid, text[], uuid[]) to dcc_app;

-- Round 2, incidents (sheet D2-17, D2-18, D2-23; backlog H-22, RQ-027, RQ-028). Additive only.
--
--   incident_reviews              the post-incident review of an incident (cause, impact, response, corrective actions,
--                                 preventive measures, who took part, when it was held). One per incident. A SEV1 or
--                                 SEV2 incident cannot be closed without one.
--   incidents.review_required     true once the incident has been SEV1 (critical) or SEV2 (high), and it stays true
--                                 even if the severity is lowered later (lowering must not be a way round the review).
--   incidents.first_resolved_at   the first moment the incident was marked resolved (or closed); starts the
--                                 5-business-day review clock. Reopening never clears or restarts it.
--   publishing_freezes.incident_id  optional link to the incident the freeze belongs to (same company).
--   publishing_freezes.two_person   true when the linked incident was SEV1 or SEV2 at the time of the freeze: the
--                                 freeze can then only be lifted by two confirmations from two different people.
--   freeze_lift_confirmations     who confirmed the lifting, on which side (security or communications), with a note.
--                                 A withdrawn confirmation stays as a row (withdrawn_at). freeze_id has no foreign
--                                 key on purpose: the freeze row is deleted when it is lifted and the record of who
--                                 lifted it must stay.

alter table incidents add column review_required boolean not null default false;
alter table incidents add column first_resolved_at timestamptz;
update incidents set review_required = true where severity in ('high', 'critical');
update incidents set first_resolved_at = resolved_at where resolved_at is not null;

create table incident_reviews (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  incident_id         uuid not null,
  cause               text not null check (length(btrim(cause)) between 3 and 5000),
  impact              text not null check (length(btrim(impact)) between 3 and 5000),
  response            text not null check (length(btrim(response)) between 3 and 5000),
  corrective_actions  text not null check (length(btrim(corrective_actions)) between 3 and 5000),
  preventive_measures text not null check (length(btrim(preventive_measures)) between 3 and 5000),
  participants        text[] not null check (cardinality(participants) between 1 and 30),
  held_at             timestamptz not null,
  recorded_by         uuid not null references users(id),
  recorded_at         timestamptz not null default now(),
  updated_by          uuid not null references users(id),
  updated_at          timestamptz not null default now(),
  unique (incident_id),
  foreign key (incident_id, company_id) references incidents(id, company_id)
);

alter table incident_reviews enable row level security;
create policy incident_reviews_select on incident_reviews for select using (app_company_allowed(company_id));
create policy incident_reviews_insert on incident_reviews for insert with check (app_company_allowed(company_id));
create policy incident_reviews_update on incident_reviews for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));
-- No DELETE: a review is corrected, never removed.
grant select, insert, update on incident_reviews to dcc_app;

alter table publishing_freezes add column incident_id uuid;
alter table publishing_freezes add column two_person boolean not null default false;
alter table publishing_freezes
  add constraint publishing_freezes_incident_fk
  foreign key (incident_id, company_id) references incidents(id, company_id);

create table freeze_lift_confirmations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  freeze_id     uuid not null,
  side          text not null check (side in ('security', 'communications')),
  confirmed_by  uuid not null references users(id),
  note          text check (note is null or length(btrim(note)) between 1 and 500),
  confirmed_at  timestamptz not null default now(),
  withdrawn_at  timestamptz
);
-- At most one live confirmation per side, and one person gives at most one live confirmation.
create unique index freeze_lift_confirmations_side on freeze_lift_confirmations (freeze_id, side) where withdrawn_at is null;
create unique index freeze_lift_confirmations_person on freeze_lift_confirmations (freeze_id, confirmed_by) where withdrawn_at is null;
create index freeze_lift_confirmations_company_idx on freeze_lift_confirmations (company_id, freeze_id);

alter table freeze_lift_confirmations enable row level security;
create policy freeze_lift_confirmations_select on freeze_lift_confirmations for select using (app_company_allowed(company_id));
create policy freeze_lift_confirmations_insert on freeze_lift_confirmations for insert with check (app_company_allowed(company_id));
create policy freeze_lift_confirmations_update on freeze_lift_confirmations for update
  using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));
-- No DELETE: withdrawn confirmations stay on record.
grant select, insert, update on freeze_lift_confirmations to dcc_app;

-- review_required is kept by the database itself, so every code path that sets a severity (the incident screen,
-- the bypass detector that opens SEV2 incidents) is covered, and nothing ever sets it back to false.
create function incidents_set_review_required() returns trigger
  language plpgsql
  as $$
begin
  if new.severity in ('high', 'critical') then
    new.review_required := true;
  elsif tg_op = 'UPDATE' then
    new.review_required := old.review_required;
  end if;
  return new;
end;
$$;
create trigger incidents_review_required
  before insert or update of severity, review_required on incidents
  for each row execute function incidents_set_review_required();

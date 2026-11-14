-- Scheduling (calendar): a publication may be handed to the engine for a later time.
-- 'scheduled' means: approved, accepted by the engine, not yet sent. Additive only.

alter table publications add column scheduled_at timestamptz;

alter table publications drop constraint publications_status_check;
alter table publications
  add constraint publications_status_check
  check (status in ('pending', 'scheduled', 'published', 'failed'));

create index publications_company_when_idx
  on publications (company_id, (coalesce(scheduled_at, requested_at)));

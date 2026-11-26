-- Round 3, removal (2026-11-26): delete or correct a published post, with a written reason (RQ-026; sheet C1-15, C2 column I, F-14).
-- Additive.
--
--   approval_policies.remove_roles   who may remove or correct a published post of the policy's category, as data
--                                    (empty = the policy's approver roles plus company_admin and group_admin).
--   publications.status 'removed'    the post was taken down on purpose. The row stays: nothing is ever erased.
--   publications.removed_*           who, when and why, and the incident the removal belongs to (same company).
--   content_items.corrects_publication_id
--                                    a content item made as a correction of a published post.
-- A removed publication stays removed: a trigger refuses to move it back (so publishing the same approved version
-- again can never bring it back to life), and the removal facts cannot be rewritten.

alter table approval_policies
  add column remove_roles text[] not null default '{}';

alter table publications
  add column removed_by uuid references users(id),
  add column removed_at timestamptz,
  add column removal_reason text,
  add column removal_incident_id uuid,
  add constraint publications_removal_incident_fk
    foreign key (removal_incident_id, company_id) references incidents(id, company_id);

alter table publications drop constraint publications_status_check;
alter table publications
  add constraint publications_status_check
  check (status in ('pending', 'scheduled', 'published', 'failed', 'cancelled', 'removed'));

-- A removal needs who, when and a written reason (ten characters or more). The link between the status and these facts is
-- checked by the trigger below, so the status check above stays the one constraint that lists the statuses.
alter table publications
  add constraint publications_removal_record check (
    removed_at is null or (removed_by is not null and length(btrim(removal_reason)) >= 10)
  );

create or replace function publications_removal_rules() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'removed' and (
         new.status is distinct from old.status
      or new.removed_by is distinct from old.removed_by
      or new.removed_at is distinct from old.removed_at
      or new.removal_reason is distinct from old.removal_reason
      or new.removal_incident_id is distinct from old.removal_incident_id) then
      raise exception 'A removed publication stays removed.' using errcode = 'check_violation';
    end if;
  end if;
  if new.status = 'removed' and new.removed_at is null then
    raise exception 'A removed publication needs who removed it, when and why (removal_record).' using errcode = 'check_violation';
  end if;
  if new.status <> 'removed' and new.removed_at is not null then
    raise exception 'Only a removed publication has removal facts (removal_record).' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger publications_removal_rules
  before insert or update on publications
  for each row execute function publications_removal_rules();

alter table content_items
  add column corrects_publication_id uuid,
  add constraint content_items_corrects_fk
    foreign key (corrects_publication_id, company_id) references publications(id, company_id);
create index content_items_corrects_idx on content_items (corrects_publication_id)
  where corrects_publication_id is not null;

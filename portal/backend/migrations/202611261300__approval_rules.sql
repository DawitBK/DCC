-- Round 2, approvals (2026-11-26): seven-day validity, time limits with a clock, the emergency post and the
-- category change. Additive, except that "one request per version" becomes "one OPEN request per version".
--
--   approval_policies.time_limit_hours / clock   the rule's time limit (null = no clock) and how it counts:
--                                                'working' (office hours) or 'continuous' (crisis, 24 hours a day).
--   approval_requests                            copies both when the request is submitted, so a later policy change
--                                                never moves a request that is waiting. Also: when it was approved,
--                                                until when that is valid (7 calendar days), the emergency record,
--                                                and how far the escalation ladder has gone.
--   status 'expired'                             on the request and on the content item: the approval ran out unused.
--   one open request per version                 an expired or rejected request no longer blocks a new submission
--                                                of the same version (the full process starts again).

alter table approval_policies
  add column time_limit_hours int check (time_limit_hours is null or time_limit_hours between 1 and 720),
  add column clock text not null default 'working' check (clock in ('working', 'continuous'));

alter table approval_requests
  add column time_limit_hours int check (time_limit_hours is null or time_limit_hours between 1 and 720),
  add column clock text not null default 'working' check (clock in ('working', 'continuous')),
  add column escalation_level int not null default 0 check (escalation_level between 0 and 6),
  add column approved_at timestamptz,
  add column valid_until timestamptz,
  add column expired_at timestamptz,
  add column emergency boolean not null default false,
  add column emergency_by uuid references users(id),
  add column emergency_reason text,
  add column emergency_at timestamptz,
  add column emergency_confirmed_by uuid references users(id),
  add column emergency_confirmed_at timestamptz,
  add constraint approval_requests_emergency_record check (
    (not emergency) or (emergency_by is not null and emergency_at is not null and length(btrim(emergency_reason)) >= 20)
  );

-- Requests approved before this release: the seven days run from their last approval.
update approval_requests r
   set approved_at = d.at, valid_until = d.at + interval '7 days'
  from (select approval_request_id, max(decided_at) as at
          from approval_decisions where decision = 'approved' group by approval_request_id) d
 where d.approval_request_id = r.id and r.status = 'approved';

alter table approval_requests drop constraint approval_requests_status_check;
alter table approval_requests
  add constraint approval_requests_status_check check (status in ('pending', 'approved', 'rejected', 'expired'));

alter table content_items drop constraint content_items_status_check;
alter table content_items
  add constraint content_items_status_check
  check (status in ('draft', 'in_review', 'approved', 'rejected', 'published', 'archived', 'expired'));

-- One OPEN (pending or approved) request per version, instead of one request ever.
alter table approval_requests drop constraint approval_requests_content_version_id_key;
create unique index approval_requests_open_version_key
  on approval_requests (content_version_id) where status in ('pending', 'approved');
create index approval_requests_version_idx on approval_requests (content_version_id, requested_at desc);
-- The sweep looks for pending requests with a clock, approved ones past their validity and unconfirmed emergencies.
create index approval_requests_sweep_idx on approval_requests (company_id, status);

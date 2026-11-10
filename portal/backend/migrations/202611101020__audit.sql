-- Append-only, hash-chained audit trail.
--
-- WHAT THIS GIVES (docs/security/AUDIT.md): the runtime role cannot UPDATE, DELETE or TRUNCATE rows (no
-- privilege, plus triggers that also stop the table owner by accident), and every row carries
-- hash = SHA-256(previous hash | fields), so an edit or a deleted row is DETECTED by audit_verify().
--
-- WHAT IT DOES NOT GIVE: it is not tamper-PROOF. A database superuser, or the owner role, can still drop
-- the triggers and rewrite the whole chain. Real tamper resistance needs the chain head and the rows
-- shipped to a store DCC administrators cannot write to (central logging/SIEM, write-once storage).

create table audit_events (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null,
  actor_user_id   uuid,
  actor_subject   text,
  action          text not null,
  target_type     text,
  target_id       text,
  company_id      uuid,
  correlation_id  text,
  ip              text,
  details         jsonb not null default '{}'::jsonb,
  prev_hash       text not null,
  hash            text not null
);
create index audit_events_company_idx on audit_events (company_id, occurred_at desc);
create index audit_events_action_idx on audit_events (action, occurred_at desc);
create index audit_events_actor_idx on audit_events (actor_user_id, occurred_at desc);

alter table audit_events enable row level security;
-- Readable within the caller's tenant scope (the API additionally requires the audit.read permission).
-- Events without a company are group-level and visible only to holders of a group-level role.
create policy audit_events_select on audit_events for select using (
  (company_id is not null and app_company_allowed(company_id))
  or (company_id is null and cardinality(app_group_ids()) > 0)
);

create function audit_block_change() returns trigger
  language plpgsql
  as $$ begin raise exception 'audit_events is append-only'; end $$;

create trigger audit_events_no_update_delete before update or delete on audit_events
  for each row execute function audit_block_change();
create trigger audit_events_no_truncate before truncate on audit_events
  for each statement execute function audit_block_change();

create function audit_compute_hash(
  p_prev text, p_at timestamptz, p_actor_user_id uuid, p_actor_subject text, p_action text,
  p_target_type text, p_target_id text, p_company_id uuid, p_correlation_id text, p_ip text, p_details jsonb
) returns text
  language sql immutable
  as $$
    select encode(sha256(convert_to(concat_ws('|',
      p_prev,
      to_char(p_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      coalesce(p_actor_user_id::text, ''), coalesce(p_actor_subject, ''), p_action,
      coalesce(p_target_type, ''), coalesce(p_target_id, ''), coalesce(p_company_id::text, ''),
      coalesce(p_correlation_id, ''), coalesce(p_ip, ''), p_details::text
    ), 'UTF8')), 'hex')
  $$;

-- The ONLY way application code writes to the audit trail. SECURITY DEFINER: it reads the chain head,
-- which the caller's own RLS scope would hide. Call it LAST in a transaction: it serialises writers
-- with an advisory lock until commit.
create function audit_append(
  p_actor_user_id uuid, p_actor_subject text, p_action text, p_target_type text, p_target_id text,
  p_company_id uuid, p_correlation_id text, p_ip text, p_details jsonb
) returns bigint
  language plpgsql security definer set search_path = public, pg_temp
  as $$
  declare
    v_prev text;
    v_at timestamptz := clock_timestamp();
    v_details jsonb := coalesce(p_details, '{}'::jsonb);
    v_id bigint;
  begin
    perform pg_advisory_xact_lock(7716001);
    select a.hash into v_prev from audit_events a order by a.id desc limit 1;
    v_prev := coalesce(v_prev, repeat('0', 64));
    insert into audit_events (occurred_at, actor_user_id, actor_subject, action, target_type, target_id,
                              company_id, correlation_id, ip, details, prev_hash, hash)
    values (v_at, p_actor_user_id, p_actor_subject, p_action, p_target_type, p_target_id,
            p_company_id, p_correlation_id, p_ip, v_details, v_prev,
            audit_compute_hash(v_prev, v_at, p_actor_user_id, p_actor_subject, p_action, p_target_type,
                               p_target_id, p_company_id, p_correlation_id, p_ip, v_details))
    returning id into v_id;
    return v_id;
  end $$;

-- Walks the whole chain. Returns only counts and the first broken row id: it leaks no event data.
create function audit_verify() returns table (ok boolean, checked bigint, first_broken_id bigint)
  language plpgsql security definer set search_path = public, pg_temp
  as $$
  declare
    r record;
    v_prev text := repeat('0', 64);
    v_count bigint := 0;
  begin
    for r in select * from audit_events order by id loop
      v_count := v_count + 1;
      if r.prev_hash <> v_prev or r.hash <> audit_compute_hash(
           r.prev_hash, r.occurred_at, r.actor_user_id, r.actor_subject, r.action, r.target_type,
           r.target_id, r.company_id, r.correlation_id, r.ip, r.details) then
        return query select false, v_count, r.id;
        return;
      end if;
      v_prev := r.hash;
    end loop;
    return query select true, v_count, null::bigint;
  end $$;

revoke all on function audit_append(uuid, text, text, text, text, uuid, text, text, jsonb) from public;
revoke all on function audit_verify() from public;
grant select on audit_events to dcc_app;
grant execute on function audit_append(uuid, text, text, text, text, uuid, text, text, jsonb) to dcc_app;
grant execute on function audit_verify() to dcc_app;

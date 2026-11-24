-- H-18: audit events that belong to no company (a category, a group-level role grant, an export, a denied request)
-- used to be readable by a group-level audit.read holder of ANY group, because the table had no group column to
-- narrow them by. This adds the column, makes the hash cover it, and narrows the read policy. Owner: Dawit.
--
-- THE HASH. audit_compute_hash gains a last field, 'group=<uuid>', which concat_ws SKIPS when the group is null.
-- So every event written before this migration (group_id null) hashes EXACTLY as it did: no row is rewritten and
-- the chain and every checkpoint stay valid. A new event that carries a group has it inside its hash, so adding,
-- changing or removing group_id on any row (old or new) is caught by audit_verify(). The old 11-argument function
-- is left in place unchanged (it is correct for rows without a group); audit_verify() now uses the new one.
--
-- WHO IS STAMPED. audit_append takes an optional group. When the caller gives none and the event has no company,
-- it falls back to the actor's group IF the actor holds memberships in exactly one group (sign-in, sign-out,
-- acting-role change, denied request). An actor with no membership (the platform owner, a failed sign-in) or with
-- memberships in several groups stays without a group.
--
-- WHO READS. Rows with a company: unchanged (the caller's companies). Company-less rows with a group: holders of a
-- group-level role in THAT group. Company-less rows with no group (all old data, failed sign-ins, the platform
-- owner's own acts): only the platform owner, flagged by the new transaction setting app.platform_owner.

alter table audit_events add column group_id uuid;
create index audit_events_group_idx on audit_events (group_id, occurred_at desc) where company_id is null;

create function app_platform_owner() returns boolean
  language sql stable parallel safe
  as $$ select coalesce(current_setting('app.platform_owner', true), '') = 'true' $$;
grant execute on function app_platform_owner() to dcc_app;

create function audit_compute_hash(
  p_prev text, p_at timestamptz, p_actor_user_id uuid, p_actor_subject text, p_action text,
  p_target_type text, p_target_id text, p_company_id uuid, p_correlation_id text, p_ip text, p_details jsonb,
  p_group_id uuid
) returns text
  language sql immutable
  as $$
    select encode(sha256(convert_to(concat_ws('|',
      p_prev,
      to_char(p_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      coalesce(p_actor_user_id::text, ''), coalesce(p_actor_subject, ''), p_action,
      coalesce(p_target_type, ''), coalesce(p_target_id, ''), coalesce(p_company_id::text, ''),
      coalesce(p_correlation_id, ''), coalesce(p_ip, ''), p_details::text,
      'group=' || p_group_id::text   -- null (skipped by concat_ws) when there is no group: old hashes unchanged
    ), 'UTF8')), 'hex')
  $$;

-- The new writer. Same contract as before (call it LAST in a transaction), one more argument.
create function audit_append(
  p_actor_user_id uuid, p_actor_subject text, p_action text, p_target_type text, p_target_id text,
  p_company_id uuid, p_correlation_id text, p_ip text, p_details jsonb, p_group_id uuid
) returns bigint
  language plpgsql security definer set search_path = public, pg_temp
  as $$
  declare
    v_prev text;
    v_at timestamptz := clock_timestamp();
    v_details jsonb := coalesce(p_details, '{}'::jsonb);
    v_group uuid := p_group_id;
    v_groups uuid[];
    v_id bigint;
  begin
    if v_group is null and p_company_id is null and p_actor_user_id is not null then
      select array_agg(distinct m.group_id) into v_groups from memberships m where m.user_id = p_actor_user_id;
      if cardinality(v_groups) = 1 then v_group := v_groups[1]; end if;
    end if;
    perform pg_advisory_xact_lock(7716001);
    select a.hash into v_prev from audit_events a order by a.id desc limit 1;
    v_prev := coalesce(v_prev, repeat('0', 64));
    insert into audit_events (occurred_at, actor_user_id, actor_subject, action, target_type, target_id,
                              company_id, group_id, correlation_id, ip, details, prev_hash, hash)
    values (v_at, p_actor_user_id, p_actor_subject, p_action, p_target_type, p_target_id,
            p_company_id, v_group, p_correlation_id, p_ip, v_details, v_prev,
            audit_compute_hash(v_prev, v_at, p_actor_user_id, p_actor_subject, p_action, p_target_type,
                               p_target_id, p_company_id, p_correlation_id, p_ip, v_details, v_group))
    returning id into v_id;
    return v_id;
  end $$;

-- The 9-argument form keeps working (anything still calling it) and gets the same actor fallback.
create or replace function audit_append(
  p_actor_user_id uuid, p_actor_subject text, p_action text, p_target_type text, p_target_id text,
  p_company_id uuid, p_correlation_id text, p_ip text, p_details jsonb
) returns bigint
  language sql security definer set search_path = public, pg_temp
  as $$ select audit_append(p_actor_user_id, p_actor_subject, p_action, p_target_type, p_target_id,
                            p_company_id, p_correlation_id, p_ip, p_details, null::uuid) $$;

create or replace function audit_verify() returns table (ok boolean, checked bigint, first_broken_id bigint)
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
           r.target_id, r.company_id, r.correlation_id, r.ip, r.details, r.group_id) then
        return query select false, v_count, r.id;
        return;
      end if;
      v_prev := r.hash;
    end loop;
    return query select true, v_count, null::bigint;
  end $$;

revoke all on function audit_append(uuid, text, text, text, text, uuid, text, text, jsonb, uuid) from public;
revoke all on function audit_compute_hash(text, timestamptz, uuid, text, text, text, text, uuid, text, text, jsonb, uuid) from public;
grant execute on function audit_append(uuid, text, text, text, text, uuid, text, text, jsonb, uuid) to dcc_app;

-- The read policy (see the header). Rows with a company are unchanged.
drop policy audit_events_select on audit_events;
create policy audit_events_select on audit_events for select using (
  (company_id is not null and app_company_allowed(company_id))
  or (company_id is null and (
        (group_id is not null and group_id = any(app_group_ids()))
        or (group_id is null and app_platform_owner())
     ))
);

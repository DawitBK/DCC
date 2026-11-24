-- H-15 (review point O-6): a retention rule for idempotency_keys. Owner: Dawit.
--
-- The table is small and the rows are evidence, so NOTHING runs by itself: an operator runs
-- `npm run idempotency:prune` (dry run unless --apply). This function is what the command calls.
--
-- WHAT IT MAY REMOVE: only keys in state 'done' that were last updated before the cutoff, and that no publication
-- still waits on ('pending' or 'scheduled'). Never 'in_progress' or 'unknown' (those are the stuck keys that
-- reconciliation works on). The cutoff may not be less than 30 days old.
--
-- WHY A FUNCTION: the guard reads publications, which row-level security hides from the runtime role without a
-- company context, so a plain DELETE from the command could not apply it. The function (SECURITY DEFINER, same
-- pattern as audit_append and notification_recipients) answers one question and returns counts only. With
-- p_apply it deletes and writes ONE audit event (counts, cutoff, a digest of the removed keys) in the same
-- transaction, so a removal without a record cannot happen.
--
-- WHAT A REMOVAL COSTS: a 'done' key is also what stops the SAME content version being published to the SAME
-- channel twice. Once it is removed, only the content item's own state and the people involved stand in the way of
-- repeating that publish. See docs/devops/IDEMPOTENCY-RETENTION.md before choosing a number of days.

create function idempotency_prune(p_cutoff timestamptz, p_apply boolean)
  returns table (
    cutoff timestamptz, applied boolean,
    done_total bigint, eligible bigint, kept_recent bigint, kept_unsettled_publication bigint,
    in_progress bigint, unknown bigint,
    removed bigint, oldest_removed timestamptz, newest_removed timestamptz, audit_event_id bigint)
  language plpgsql security definer set search_path = public, pg_temp
  as $$
  declare
    v_done bigint;
    v_eligible bigint;
    v_recent bigint;
    v_unsettled bigint;
    v_in_progress bigint;
    v_unknown bigint;
    v_removed bigint := 0;
    v_oldest timestamptz;
    v_newest timestamptz;
    v_digest text;
    v_audit bigint;
  begin
    if p_cutoff is null or p_cutoff > now() - interval '30 days' then
      raise exception 'idempotency_prune: the cutoff must be at least 30 days in the past';
    end if;

    select count(*) filter (where k.state = 'done'),
           count(*) filter (where k.state = 'in_progress'),
           count(*) filter (where k.state = 'unknown'),
           count(*) filter (where k.state = 'done' and k.updated_at >= p_cutoff),
           count(*) filter (where k.state = 'done' and k.updated_at < p_cutoff and exists (
             select 1 from publications p where p.idempotency_key = k.key and p.status in ('pending', 'scheduled')))
      into v_done, v_in_progress, v_unknown, v_recent, v_unsettled
      from idempotency_keys k;
    v_eligible := v_done - v_recent - v_unsettled;

    if p_apply then
      with gone as (
        delete from idempotency_keys k
         where k.state = 'done' and k.updated_at < p_cutoff
           and not exists (select 1 from publications p
                            where p.idempotency_key = k.key and p.status in ('pending', 'scheduled'))
        returning k.key, k.updated_at
      )
      select count(*), min(g.updated_at), max(g.updated_at),
             encode(sha256(convert_to(coalesce(string_agg(g.key, E'\n' order by g.key), ''), 'UTF8')), 'hex')
        into v_removed, v_oldest, v_newest, v_digest
        from gone g;

      v_audit := audit_append(
        null, 'maintenance:idempotency-prune', 'maintenance.idempotency_keys_pruned', 'idempotency_keys', null,
        null, null, null,
        jsonb_build_object(
          'cutoff', p_cutoff, 'removed', v_removed, 'eligibleBefore', v_eligible,
          'doneBefore', v_done, 'keptRecent', v_recent, 'keptUnsettledPublication', v_unsettled,
          'inProgressUntouched', v_in_progress, 'unknownUntouched', v_unknown,
          'oldestRemovedUpdatedAt', v_oldest, 'newestRemovedUpdatedAt', v_newest,
          'removedKeysSha256', v_digest));
    end if;

    return query select p_cutoff, p_apply, v_done, v_eligible, v_recent, v_unsettled,
                        v_in_progress, v_unknown, v_removed, v_oldest, v_newest, v_audit;
  end $$;

revoke all on function idempotency_prune(timestamptz, boolean) from public;
grant execute on function idempotency_prune(timestamptz, boolean) to dcc_app;

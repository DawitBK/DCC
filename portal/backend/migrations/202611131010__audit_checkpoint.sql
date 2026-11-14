-- Audit checkpoints (decision D-06, task L-09). Owner: Dawit.
--
-- WHY: audit_verify() proves the chain is internally consistent. It cannot notice a privileged insider who
-- switches the trigger off and rewrites EVERY row with freshly computed hashes: the forged chain is consistent
-- too. The answer is to remember, somewhere the database administrators cannot write, what the chain looked
-- like at a point in time, and to compare later. These two functions give the checkpoint job what it needs
-- and nothing more: positions, counts and hashes. No event data leaves through them.

create function audit_head() returns table (last_id bigint, last_hash text, events bigint)
  language sql stable security definer set search_path = public, pg_temp
  as $$
    select coalesce(max(a.id), 0),
           coalesce((select h.hash from audit_events h order by h.id desc limit 1), repeat('0', 64)),
           count(*)
      from audit_events a
  $$;

create function audit_hash_at(p_id bigint) returns text
  language sql stable security definer set search_path = public, pg_temp
  as $$ select a.hash from audit_events a where a.id = p_id $$;

revoke all on function audit_head() from public;
revoke all on function audit_hash_at(bigint) from public;
grant execute on function audit_head() to dcc_app;
grant execute on function audit_hash_at(bigint) to dcc_app;

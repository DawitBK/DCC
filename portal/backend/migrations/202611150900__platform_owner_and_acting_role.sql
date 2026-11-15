-- 1. A person who holds several roles may choose one to act as for a session (null = all together).
alter table sessions add column acting_role text;

-- 2. The platform owner (set by configuration, never stored as a membership) works across every group.
--    Access is resolved in the person's own row-level context, which cannot list groups; this function
--    gives the access resolver the list. It returns ids only.
create function platform_all_group_ids() returns setof uuid
  language sql stable security definer set search_path = public, pg_temp
  as $$ select id from groups $$;

revoke all on function platform_all_group_ids() from public;
grant execute on function platform_all_group_ids() to dcc_app;

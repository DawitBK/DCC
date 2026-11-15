-- Finding a person by email so they can be given their first role. Owner: Dawit (found 2026-11-14).
--
-- THE DEFECT THIS FIXES: a person who signed in through the SSO but holds no role yet is invisible to
-- every administrator (users_select shows a person only through a shared company or group, which is
-- right), and a role could be granted only by the person's internal id. So an administrator had no way to
-- give anyone their FIRST role. The tests never noticed: they took the id from the fixture.
--
-- THE FIX: one narrow SECURITY DEFINER function, like the other access helpers. It widens no policy:
--   * it answers only for a caller who already acts for some company or group (no role: nothing);
--   * it needs the whole email, exactly (no search, no partial match), so it cannot be used to browse;
--   * it returns the id only, and only for an active person; two people with one email: nothing.
-- The API calls it only after the caller's `user.manage` permission was checked for the target scope.

create function access_find_user_by_email(p_email text) returns uuid
  language sql stable security definer set search_path = public, pg_temp
  as $$
    select case when count(*) = 1 then (array_agg(u.id))[1] end
      from users u
     where lower(u.email) = lower(btrim(p_email))
       and u.status = 'active'
       and (cardinality(app_group_ids()) > 0 or cardinality(app_company_ids()) > 0)
  $$;

revoke all on function access_find_user_by_email(text) from public;
grant execute on function access_find_user_by_email(text) to dcc_app;

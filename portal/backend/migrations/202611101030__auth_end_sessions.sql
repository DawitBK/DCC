-- Back-channel logout and account disablement must end a person's sessions looked up by the IdP subject.
-- That lookup touches `users`, which is protected by RLS, and a logout notification arrives with no tenant
-- context (it is a server-to-server call from the IdP). A narrow SECURITY DEFINER function does exactly
-- this one job instead of widening any policy.

create function auth_end_sessions_for_subject(p_subject text) returns integer
  language plpgsql security definer set search_path = public, pg_temp
  as $$
  declare v_rows integer;
  begin
    delete from sessions where user_id in (select u.id from users u where u.idp_subject = p_subject);
    get diagnostics v_rows = row_count;
    return v_rows;
  end $$;

revoke all on function auth_end_sessions_for_subject(text) from public;
grant execute on function auth_end_sessions_for_subject(text) to dcc_app;

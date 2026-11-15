-- Who must be told about an event in a company. Owner: Dawit (found in the review of 2026-11-13).
--
-- THE DEFECT THIS FIXES: the notifications service chose recipients by reading `memberships` inside the
-- ACTOR's tenant context. Row-level security shows a company-level person only the memberships of their
-- own company, so everyone who holds the permission at GROUP level (a Group marketing reviewer, the Group
-- CTO) was silently left out whenever a company-level person acted. No error, just no notification.
--
-- THE FIX: one narrow SECURITY DEFINER function, the same approach as audit_append and the auth_* functions.
-- It answers exactly one question and widens no policy:
--   * it refuses (returns nothing) unless the caller may already touch that company;
--   * it returns user ids only (no emails, no names, no roles);
--   * it returns people of that company and of that company's own group, never another group's.

create function notification_recipients(p_company_id uuid, p_roles text[])
  returns table (user_id uuid)
  language sql stable security definer set search_path = public, pg_temp
  as $$
    select distinct m.user_id
      from memberships m
      join companies c on c.id = p_company_id
      join users u on u.id = m.user_id and u.status = 'active'
     where app_company_allowed(p_company_id)
       and m.role = any(p_roles)
       and (m.company_id = p_company_id or (m.company_id is null and m.group_id = c.group_id))
  $$;

revoke all on function notification_recipients(uuid, text[]) from public;
grant execute on function notification_recipients(uuid, text[]) to dcc_app;

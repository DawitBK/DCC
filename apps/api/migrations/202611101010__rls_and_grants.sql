-- Tenant isolation (PostgreSQL Row-Level Security) and least-privilege grants.
--
-- HOW IT WORKS (docs/security/TENANCY-AND-RLS.md):
--   * The API never trusts a company id from the browser. For every request it resolves the caller's
--     memberships from the database and, inside ONE transaction, sets three TRANSACTION-LOCAL settings:
--        app.user_id      the caller
--        app.group_ids    groups where the caller holds a group-level role (csv)
--        app.company_ids  companies where the caller holds a company-level role (csv)
--   * Settings are set with set_config(..., is_local => true), so they vanish at COMMIT/ROLLBACK and
--     can never leak to the next request that reuses the pooled connection.
--   * No settings => no rows (the policies fail closed).
--   * The API connects as dcc_app: not superuser, no BYPASSRLS, not the table owner, so policies bind it.
--   * RLS is the TENANT boundary. WHAT a person may do inside a tenant (RBAC) is enforced in the API.

create function app_user_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function app_group_ids() returns uuid[]
  language sql stable parallel safe
  as $$ select coalesce(string_to_array(nullif(current_setting('app.group_ids', true), ''), ',')::uuid[], '{}'::uuid[]) $$;

create function app_company_ids() returns uuid[]
  language sql stable parallel safe
  as $$ select coalesce(string_to_array(nullif(current_setting('app.company_ids', true), ''), ',')::uuid[], '{}'::uuid[]) $$;

-- True when the caller may touch this company: an explicit company membership, or a group-level role
-- in the company's group (explicit and always recorded in the membership table).
create function app_company_allowed(p_company_id uuid) returns boolean
  language sql stable
  as $$
    select p_company_id is not null and (
      p_company_id = any(app_company_ids())
      or exists (select 1 from companies c where c.id = p_company_id and c.group_id = any(app_group_ids()))
    )
  $$;

alter table groups              enable row level security;
alter table companies           enable row level security;
alter table brands              enable row level security;
alter table users               enable row level security;
alter table memberships         enable row level security;
alter table social_accounts     enable row level security;
alter table account_assignments enable row level security;

create policy groups_select on groups for select using (
  id = any(app_group_ids())
  or exists (select 1 from companies c where c.group_id = groups.id and c.id = any(app_company_ids()))
);

create policy companies_select on companies for select using (
  id = any(app_company_ids()) or group_id = any(app_group_ids())
);
create policy companies_insert on companies for insert with check (group_id = any(app_group_ids()));
create policy companies_update on companies for update
  using (id = any(app_company_ids()) or group_id = any(app_group_ids()))
  with check (id = any(app_company_ids()) or group_id = any(app_group_ids()));

create policy brands_select on brands for select using (app_company_allowed(company_id));
create policy brands_insert on brands for insert with check (app_company_allowed(company_id));
create policy brands_update on brands for update using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));

create policy social_accounts_select on social_accounts for select using (app_company_allowed(company_id));
create policy social_accounts_insert on social_accounts for insert with check (app_company_allowed(company_id));
create policy social_accounts_update on social_accounts for update using (app_company_allowed(company_id)) with check (app_company_allowed(company_id));

create policy account_assignments_select on account_assignments for select using (app_company_allowed(company_id));
create policy account_assignments_insert on account_assignments for insert with check (app_company_allowed(company_id));
create policy account_assignments_delete on account_assignments for delete using (app_company_allowed(company_id));

-- A person always sees their own memberships (that is how access is resolved); managers see those in their scope.
create policy memberships_select on memberships for select using (
  user_id = app_user_id()
  or group_id = any(app_group_ids())
  or app_company_allowed(company_id)
);
create policy memberships_insert on memberships for insert with check (
  (company_id is null and group_id = any(app_group_ids()))
  or (company_id is not null and app_company_allowed(company_id))
);
create policy memberships_delete on memberships for delete using (
  (company_id is null and group_id = any(app_group_ids()))
  or (company_id is not null and app_company_allowed(company_id))
);

-- People are visible to themselves and to managers of a scope the person belongs to.
create policy users_select on users for select using (
  id = app_user_id()
  or exists (
    select 1 from memberships m
    where m.user_id = users.id and (m.group_id = any(app_group_ids()) or app_company_allowed(m.company_id))
  )
);

-- Login support: runs before any tenant context exists, so it is a narrow SECURITY DEFINER function
-- instead of a broad policy. It can only insert or refresh a user keyed by the IdP subject.
create function auth_upsert_user(p_subject text, p_email text, p_name text)
  returns table (id uuid, status text)
  language sql security definer set search_path = public, pg_temp
  as $$
    insert into users (idp_subject, email, display_name, last_login_at)
    values (p_subject, p_email, coalesce(p_name, ''), now())
    on conflict (idp_subject) do update
      set email = excluded.email, display_name = excluded.display_name, last_login_at = now()
    returning users.id, users.status
  $$;

-- Bootstrap of the first administrators from the IdP's app-role claim. Touches ONE role (group_admin)
-- with source 'idp', in ONE group, and never removes anything granted inside DCC.
create function auth_sync_idp_group_admin(p_user_id uuid, p_group_slug text, p_is_admin boolean)
  returns text
  language plpgsql security definer set search_path = public, pg_temp
  as $$
  declare v_group uuid;
  declare v_rows int;
  begin
    select g.id into v_group from groups g where g.slug = p_group_slug;
    if v_group is null then return 'no_group'; end if;
    if p_is_admin then
      insert into memberships (user_id, group_id, company_id, role, source)
      values (p_user_id, v_group, null, 'group_admin', 'idp')
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      return case when v_rows > 0 then 'granted' else 'unchanged' end;
    end if;
    delete from memberships
     where user_id = p_user_id and group_id = v_group and company_id is null
       and role = 'group_admin' and source = 'idp';
    get diagnostics v_rows = row_count;
    return case when v_rows > 0 then 'revoked' else 'unchanged' end;
  end $$;

revoke all on function auth_upsert_user(text, text, text) from public;
revoke all on function auth_sync_idp_group_admin(uuid, text, boolean) from public;

-- Least privilege for the runtime role. Note what is NOT granted: DELETE on companies/brands/accounts/users,
-- any DDL, and anything on audit_events beyond SELECT (see the audit migration).
grant select on groups, companies, brands, users, memberships, social_accounts, account_assignments to dcc_app;
grant insert, update on companies, brands, social_accounts to dcc_app;
grant insert, delete on memberships, account_assignments to dcc_app;
grant select, insert, update, delete on sessions, auth_transactions to dcc_app;
grant execute on function app_user_id(), app_group_ids(), app_company_ids(), app_company_allowed(uuid) to dcc_app;
grant execute on function auth_upsert_user(text, text, text), auth_sync_idp_group_admin(uuid, text, boolean) to dcc_app;

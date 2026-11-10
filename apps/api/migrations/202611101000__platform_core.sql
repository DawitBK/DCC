-- Platform core: Group -> Company -> Brand -> Social account, people, memberships, sessions.
-- Owner: Dawit. Domain tables (content, approvals, incidents, ...) are Hirko's and go in their own migrations.

create table groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

create table companies (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id),
  name        text not null,
  slug        text not null,
  status      text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (group_id, slug),
  unique (id, group_id)
);

create table brands (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  name        text not null,
  slug        text not null,
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_at  timestamptz not null default now(),
  unique (company_id, slug),
  unique (id, company_id)
);

-- A person, as known to the existing Kerchanshe IdP. DCC stores NO password and NO tokens here.
create table users (
  id             uuid primary key default gen_random_uuid(),
  idp_subject    text not null unique,
  email          text not null,
  display_name   text not null default '',
  status         text not null default 'active' check (status in ('active', 'disabled')),
  last_login_at  timestamptz,
  created_at     timestamptz not null default now()
);
create unique index users_email_lower_key on users (lower(email));

-- Role held at group level (company_id null) or for one company. DCC owns this; the IdP does not.
create table memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  group_id    uuid not null references groups(id),
  company_id  uuid,
  role        text not null check (role in (
                'group_admin', 'group_cto', 'security_admin', 'group_marketing', 'auditor',
                'company_admin', 'company_executive', 'company_marketing_manager',
                'content_creator', 'content_reviewer', 'publisher')),
  -- 'idp' = granted from an IdP claim at login (revoked when the claim disappears); 'dcc' = granted in DCC.
  source      text not null default 'dcc' check (source in ('dcc', 'idp')),
  created_by  uuid references users(id),
  created_at  timestamptz not null default now(),
  foreign key (company_id, group_id) references companies(id, group_id),
  constraint membership_role_scope check (
    (role in ('group_admin', 'group_cto', 'security_admin', 'group_marketing') and company_id is null)
    or (role in ('company_admin', 'company_executive', 'company_marketing_manager',
                 'content_creator', 'content_reviewer', 'publisher') and company_id is not null)
    or role = 'auditor'
  )
);
create unique index memberships_unique
  on memberships (user_id, group_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), role);
create index memberships_user_idx on memberships (user_id);
create index memberships_company_idx on memberships (company_id);

create table social_accounts (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  brand_id              uuid,
  platform              text not null check (platform in ('facebook', 'instagram', 'linkedin', 'youtube', 'tiktok', 'x')),
  display_name          text not null,
  handle                text not null,
  public_url            text,
  status                text not null default 'active'
                          check (status in ('active', 'needs_attention', 'disconnected', 'archived')),
  owner_user_id         uuid references users(id),
  backup_admin_user_id  uuid references users(id),
  -- The operational engine's own channel id (Postiz "integration id"). DCC never stores social tokens.
  engine_channel_id     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, platform, handle),
  unique (id, company_id),
  foreign key (brand_id, company_id) references brands(id, company_id)
);
create unique index social_accounts_engine_channel_key on social_accounts (engine_channel_id)
  where engine_channel_id is not null;

-- Which people may work with which account (account-level scoping inside a company).
create table account_assignments (
  id                 uuid primary key default gen_random_uuid(),
  social_account_id  uuid not null,
  company_id         uuid not null,
  user_id            uuid not null references users(id) on delete cascade,
  created_at         timestamptz not null default now(),
  unique (social_account_id, user_id),
  foreign key (social_account_id, company_id) references social_accounts(id, company_id) on delete cascade
);

-- Server-side sessions. The browser only holds a random id; only its SHA-256 is stored here.
create table sessions (
  id_hash        text primary key,
  user_id        uuid not null references users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  -- The IdP id_token, encrypted (needed only as the logout hint). Never an access or refresh token.
  id_token_enc   text,
  idp_sid        text,
  ip             text,
  user_agent     text
);
create index sessions_user_idx on sessions (user_id);
create index sessions_expires_idx on sessions (expires_at);

-- One row per login attempt in flight: state, nonce and PKCE verifier. Single use, short lived.
create table auth_transactions (
  state_hash     text primary key,
  nonce          text not null,
  code_verifier  text not null,
  return_to      text not null default '/',
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);
create index auth_transactions_expires_idx on auth_transactions (expires_at);

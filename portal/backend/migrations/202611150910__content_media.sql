-- Pictures and videos for posts. The file is on the server's disk (DCC_MEDIA_DIR); this is its record.
-- A version's media are fixed at creation, like its text and its targets.

create table content_media (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id),
  uploaded_by  uuid not null references users(id),
  kind         text not null check (kind in ('image', 'video')),
  file_name    text not null,
  mime_type    text not null,
  size_bytes   bigint not null check (size_bytes > 0),
  storage_key  text not null unique,
  created_at   timestamptz not null default now(),
  unique (id, company_id)
);
create index content_media_company_idx on content_media (company_id, created_at desc);

create table content_version_media (
  content_version_id uuid not null references content_versions(id),
  media_id           uuid not null,
  company_id         uuid not null references companies(id),
  position           int not null check (position >= 0),
  primary key (content_version_id, media_id),
  foreign key (media_id, company_id) references content_media(id, company_id)
);

alter table content_media         enable row level security;
alter table content_version_media enable row level security;

create policy content_media_select on content_media for select using (app_company_allowed(company_id));
create policy content_media_insert on content_media for insert with check (app_company_allowed(company_id));
create policy content_version_media_select on content_version_media for select using (app_company_allowed(company_id));
create policy content_version_media_insert on content_version_media for insert with check (app_company_allowed(company_id));

grant select, insert on content_media, content_version_media to dcc_app;

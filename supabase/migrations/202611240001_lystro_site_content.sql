-- LYSTRO public website content controlled by authorized administrators.
create table if not exists public.lystro_site_content (
  id text primary key check (id = 'public'),
  content jsonb not null,
  updated_by uuid null,
  updated_at timestamptz not null default now()
);
alter table public.lystro_site_content enable row level security;
revoke all on public.lystro_site_content from anon, authenticated;
grant select, insert, update on public.lystro_site_content to service_role;

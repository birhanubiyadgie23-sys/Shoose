-- LYSTRO operations foundation. Safe additive migration: existing orders are preserved.
create extension if not exists pgcrypto;

create table if not exists public.lystro_sub_cities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.lystro_woredas (
  id uuid primary key default gen_random_uuid(),
  sub_city_id uuid not null references public.lystro_sub_cities(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(sub_city_id,name)
);
create table if not exists public.lystro_services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  price numeric(12,2) not null default 0 check(price>=0),
  duration_minutes integer not null default 60 check(duration_minutes>0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.lystro_professionals (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  email text,
  sub_city_id uuid not null references public.lystro_sub_cities(id) on delete restrict,
  woreda_id uuid not null references public.lystro_woredas(id) on delete restrict,
  address text not null default '',
  experience_years integer not null default 0 check(experience_years>=0),
  notes text not null default '',
  status text not null default 'pending_review'
    check(status in ('pending_review','approved','rejected','suspended')),
  availability text not null default 'available'
    check(availability in ('available','busy','unavailable')),
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.lystro_professional_services (
  professional_id uuid not null references public.lystro_professionals(id) on delete cascade,
  service_id uuid not null references public.lystro_services(id) on delete restrict,
  primary key(professional_id,service_id)
);
alter table public.orders add column if not exists assigned_professional_id uuid
  references public.lystro_professionals(id) on delete set null;
alter table public.orders add column if not exists accepted_at timestamptz;
alter table public.orders add column if not exists assigned_at timestamptz;
alter table public.orders add column if not exists started_at timestamptz;
alter table public.orders add column if not exists completed_at timestamptz;
alter table public.orders add column if not exists updated_at timestamptz not null default now();

create table if not exists public.lystro_assignment_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  professional_id uuid not null references public.lystro_professionals(id) on delete restrict,
  assigned_by uuid,
  status text not null default 'suggested'
    check(status in ('suggested','assigned','accepted','declined','completed','cancelled')),
  note text not null default '',
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists lystro_professionals_area_idx on public.lystro_professionals(sub_city_id,woreda_id,status);
create index if not exists lystro_assignment_order_idx on public.lystro_assignment_history(order_id,created_at desc);
create index if not exists orders_assigned_professional_idx on public.orders(assigned_professional_id);

insert into public.lystro_sub_cities(name) values
('Bole'),('Yeka'),('Arada'),('Kirkos'),('Addis Ketema'),('Akaki-Kaliti'),
('Gullele'),('Kolfe Keranio'),('Lideta'),('Nifas Silk-Lafto'),('Lemi Kura')
on conflict(name) do nothing;

insert into public.lystro_services(name,description,price,duration_minutes) values
('Basic Shoe Cleaning','Standard shoe cleaning service',0,60),
('Deep Cleaning','Detailed deep shoe cleaning service',0,90),
('Premium Shoe Care','Premium shoe care and finishing service',0,120)
on conflict(name) do nothing;

alter table public.lystro_sub_cities enable row level security;
alter table public.lystro_woredas enable row level security;
alter table public.lystro_services enable row level security;
alter table public.lystro_professionals enable row level security;
alter table public.lystro_professional_services enable row level security;
alter table public.lystro_assignment_history enable row level security;

revoke all on public.lystro_sub_cities,public.lystro_woredas,public.lystro_services,
 public.lystro_professionals,public.lystro_professional_services,public.lystro_assignment_history from anon,authenticated;
grant select,insert,update,delete on public.lystro_sub_cities,public.lystro_woredas,public.lystro_services,
 public.lystro_professionals,public.lystro_professional_services,public.lystro_assignment_history to service_role;
grant select on public.admin_users to service_role;
grant select,insert,update,delete on public.orders to service_role;

-- Keep the existing order records and legacy 'confirmed' values intact.

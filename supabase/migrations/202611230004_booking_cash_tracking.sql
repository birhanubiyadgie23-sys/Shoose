-- LYSTRO booking, price snapshot, cash-on-service and customer tracking.
-- Safe additive migration: existing orders and services are preserved.
create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists pickup_date date,
  add column if not exists pickup_time text,
  add column if not exists shoe_count integer not null default 1 check (shoe_count between 1 and 30),
  add column if not exists unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  add column if not exists total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  add column if not exists delivery_type text not null default 'pickup_and_return',
  add column if not exists cash_payment_status text not null default 'unpaid'
    check (cash_payment_status in ('unpaid','paid','waived')),
  add column if not exists cash_paid_at timestamptz,
  add column if not exists tracking_code text;

update public.orders
set tracking_code = encode(gen_random_bytes(18), 'hex')
where tracking_code is null;

alter table public.orders alter column tracking_code set default encode(gen_random_bytes(18), 'hex');
create unique index if not exists orders_tracking_code_uidx
  on public.orders(tracking_code) where tracking_code is not null;
create index if not exists orders_pickup_date_idx on public.orders(pickup_date);

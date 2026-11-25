-- LYSTRO cash collection reporting and admin verification.
-- Additive only: preserve existing payment fields and order records.
alter table public.orders
  add column if not exists cash_reported_at timestamptz,
  add column if not exists cash_reported_by uuid references public.lystro_professionals(id) on delete set null,
  add column if not exists cash_verified_at timestamptz,
  add column if not exists cash_verified_by uuid references auth.users(id) on delete set null;

create index if not exists orders_cash_verification_idx
  on public.orders (cash_payment_status, cash_reported_at);

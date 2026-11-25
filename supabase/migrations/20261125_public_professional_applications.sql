-- Allow public professional applications without an authenticated account.
-- The public API writes created_by = NULL and keeps each application pending review.
alter table public.lystro_professionals
  alter column created_by drop not null;

-- Support duplicate-application lookups by contact details.
create index if not exists lystro_professionals_phone_lookup_idx
  on public.lystro_professionals (phone);

create index if not exists lystro_professionals_email_lookup_idx
  on public.lystro_professionals (lower(email))
  where email is not null;

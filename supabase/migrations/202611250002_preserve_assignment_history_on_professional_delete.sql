-- Preserve assignment history when a professional profile is deleted.
-- Orders already use ON DELETE SET NULL for assigned_professional_id.
alter table public.lystro_assignment_history
  alter column professional_id drop not null;

alter table public.lystro_assignment_history
  drop constraint if exists lystro_assignment_history_professional_id_fkey;

alter table public.lystro_assignment_history
  add constraint lystro_assignment_history_professional_id_fkey
  foreign key (professional_id)
  references public.lystro_professionals(id)
  on delete set null;

comment on column public.lystro_assignment_history.professional_id is
  'Nullable so historical assignments remain after a professional profile is deleted.';

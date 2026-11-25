-- LYSTRO professional workload capacity (1..20) and atomic assignment approval.
alter table public.lystro_professionals
  add column if not exists max_active_jobs integer not null default 20
  check (max_active_jobs between 1 and 20);

create index if not exists orders_professional_active_idx
  on public.orders(assigned_professional_id, status)
  where status in ('assigned','in_progress');

create or replace function public.lystro_approve_assignment(
  p_assignment_id uuid,
  p_admin_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.lystro_assignment_history%rowtype;
  p public.lystro_professionals%rowtype;
  o public.orders%rowtype;
  active_count integer;
  service_ok boolean;
begin
  select * into a from public.lystro_assignment_history
    where id = p_assignment_id for update;
  if not found or a.status <> 'suggested' then
    raise exception 'Pending assignment suggestion not found.';
  end if;

  select * into p from public.lystro_professionals
    where id = a.professional_id for update;
  if not found or p.status <> 'approved' or p.availability = 'unavailable' then
    raise exception 'Professional is not approved or is unavailable.';
  end if;

  select * into o from public.orders where id = a.order_id for update;
  if not found or o.status not in ('accepted','confirmed')
     or o.assigned_professional_id is not null then
    raise exception 'Order is no longer eligible for assignment.';
  end if;

  select exists(
    select 1 from public.lystro_professional_services ps
    join public.lystro_services s on s.id = ps.service_id
    where ps.professional_id = p.id and s.name = o.service_type and s.is_active = true
  ) into service_ok;
  if not service_ok then
    raise exception 'Professional does not offer this service.';
  end if;

  select count(*)::integer into active_count
    from public.orders
    where assigned_professional_id = p.id
      and status in ('assigned','in_progress');
  if active_count >= p.max_active_jobs then
    raise exception 'Professional has reached their active-job capacity.';
  end if;

  update public.orders
    set assigned_professional_id = p.id,
        status = 'assigned',
        assigned_at = now(),
        updated_at = now()
    where id = o.id;

  update public.lystro_professionals
    set availability = case
      when availability = 'unavailable' then 'unavailable'
      when active_count + 1 >= max_active_jobs then 'busy'
      else 'available'
    end,
    updated_at = now()
    where id = p.id;

  update public.lystro_assignment_history
    set status = 'accepted', responded_at = now(),
        note = concat_ws(' | ', nullif(note,''), 'Approved by Super Admin')
    where id = a.id;

  return jsonb_build_object(
    'success', true,
    'order_id', o.id,
    'professional_id', p.id,
    'active_jobs', active_count + 1,
    'max_active_jobs', p.max_active_jobs
  );
end;
$$;

revoke all on function public.lystro_approve_assignment(uuid,uuid) from public, anon, authenticated;
grant execute on function public.lystro_approve_assignment(uuid,uuid) to service_role;

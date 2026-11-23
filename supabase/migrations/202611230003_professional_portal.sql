-- Secure professional portal identity and job lifecycle.
alter table public.lystro_professionals
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

create or replace function public.lystro_professional_update_job(
  p_user_id uuid,
  p_order_id uuid,
  p_action text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.lystro_professionals%rowtype;
  o public.orders%rowtype;
  active_count integer;
begin
  if p_action not in ('start','complete') then
    raise exception 'Invalid job action.';
  end if;

  select * into p
    from public.lystro_professionals
    where auth_user_id = p_user_id
    for update;
  if not found or p.status <> 'approved' then
    raise exception 'Professional account is not approved.';
  end if;

  select * into o
    from public.orders
    where id = p_order_id
      and assigned_professional_id = p.id
    for update;
  if not found then
    raise exception 'This order is not assigned to your account.';
  end if;

  if p_action = 'start' then
    if o.status <> 'assigned' then
      raise exception 'Only assigned jobs can be started.';
    end if;
    update public.orders
      set status = 'in_progress', started_at = now(), updated_at = now()
      where id = o.id;
  else
    if o.status <> 'in_progress' then
      raise exception 'Only jobs in progress can be completed.';
    end if;
    update public.orders
      set status = 'completed', completed_at = now(), updated_at = now()
      where id = o.id;
    update public.lystro_assignment_history
      set status = 'completed', responded_at = now(),
          note = concat_ws(' | ', nullif(note,''), 'Marked completed by professional')
      where order_id = o.id and professional_id = p.id
        and status in ('accepted','assigned');
  end if;

  select count(*)::integer into active_count
    from public.orders
    where assigned_professional_id = p.id
      and status in ('assigned','in_progress');

  if p.availability <> 'unavailable' then
    update public.lystro_professionals
      set availability = case
        when active_count >= max_active_jobs then 'busy'
        else 'available'
      end,
      updated_at = now()
      where id = p.id;
  end if;

  return jsonb_build_object(
    'success', true,
    'order_id', o.id,
    'status', case when p_action = 'start' then 'in_progress' else 'completed' end,
    'active_jobs', active_count,
    'max_active_jobs', p.max_active_jobs
  );
end;
$$;

revoke all on function public.lystro_professional_update_job(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.lystro_professional_update_job(uuid,uuid,text) to service_role;

-- 07_tasks_presence.sql
-- Endurecimiento operativo: tareas con evidencia + ingreso/salida supervisora

begin;

create extension if not exists cube;
create extension if not exists earthdistance;

create table if not exists public.operational_tasks (
  id bigserial primary key,
  shift_id integer not null references public.shifts(id) on delete cascade,
  restaurant_id integer not null references public.restaurants(id) on delete cascade,
  assigned_employee_id uuid not null references public.users(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete restrict,
  title text not null,
  description text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  due_at timestamptz null,
  resolved_at timestamptz null,
  resolved_by uuid null references public.users(id) on delete set null,
  evidence_path text null,
  evidence_hash text null,
  evidence_mime_type text null,
  evidence_size_bytes bigint null check (evidence_size_bytes is null or evidence_size_bytes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_operational_tasks_assignee_status
  on public.operational_tasks (assigned_employee_id, status, created_at desc);

create index if not exists idx_operational_tasks_restaurant_status
  on public.operational_tasks (restaurant_id, status, created_at desc);

create table if not exists public.supervisor_presence_logs (
  id bigserial primary key,
  supervisor_id uuid not null references public.users(id) on delete cascade,
  restaurant_id integer not null references public.restaurants(id) on delete cascade,
  phase text not null check (phase in ('start', 'end')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  evidence_path text not null,
  evidence_hash text not null,
  evidence_mime_type text not null,
  evidence_size_bytes bigint not null check (evidence_size_bytes > 0),
  recorded_at timestamptz not null default now(),
  notes text null
);

create index if not exists idx_supervisor_presence_supervisor_recorded
  on public.supervisor_presence_logs (supervisor_id, recorded_at desc);

create index if not exists idx_supervisor_presence_restaurant_recorded
  on public.supervisor_presence_logs (restaurant_id, recorded_at desc);

create or replace function public.trg_operational_tasks_guard()
returns trigger
language plpgsql
as $$
declare
  v_role text;
  v_shift_employee uuid;
  v_shift_restaurant integer;
begin
  v_role := public.actor_role_secure();

  if tg_op = 'INSERT' then
    if auth.uid() is null then
      raise exception 'No autenticado';
    end if;

    if v_role not in ('super_admin', 'supervisora') then
      raise exception 'Solo supervision puede crear tareas';
    end if;

    select s.employee_id, s.restaurant_id
      into v_shift_employee, v_shift_restaurant
    from public.shifts s
    where s.id = new.shift_id;

    if v_shift_employee is null then
      raise exception 'Turno invalido para crear tarea';
    end if;

    if v_role = 'supervisora' and not public.is_supervisor_for_restaurant(v_shift_restaurant) then
      raise exception 'Supervisora no asignada al restaurante';
    end if;

    new.created_by := coalesce(new.created_by, auth.uid());
    new.assigned_employee_id := coalesce(new.assigned_employee_id, v_shift_employee);
    new.restaurant_id := coalesce(new.restaurant_id, v_shift_restaurant);
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();

    if old.evidence_path is not null and new.evidence_path is distinct from old.evidence_path then
      raise exception 'evidence_path de tarea es inmutable';
    end if;

    if old.evidence_hash is not null and new.evidence_hash is distinct from old.evidence_hash then
      raise exception 'evidence_hash de tarea es inmutable';
    end if;

    if new.status = 'completed' then
      if new.evidence_path is null
        or new.evidence_hash is null
        or new.evidence_mime_type is null
        or new.evidence_size_bytes is null then
        raise exception 'Evidencia completa requerida para cerrar tarea';
      end if;
      new.resolved_at := coalesce(new.resolved_at, now());
      new.resolved_by := coalesce(new.resolved_by, auth.uid());
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'tr_operational_tasks_guard') then
    drop trigger tr_operational_tasks_guard on public.operational_tasks;
  end if;

  create trigger tr_operational_tasks_guard
  before insert or update on public.operational_tasks
  for each row execute function public.trg_operational_tasks_guard();
end $$;

create or replace function public.trg_supervisor_presence_guard()
returns trigger
language plpgsql
as $$
declare
  v_role text;
  v_lat double precision;
  v_lng double precision;
  v_radius integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  v_role := public.actor_role_secure();
  if v_role not in ('supervisora', 'super_admin') then
    raise exception 'Solo supervision puede registrar presencia';
  end if;

  if v_role = 'supervisora' and not public.is_supervisor_for_restaurant(new.restaurant_id) then
    raise exception 'Supervisora no asignada al restaurante';
  end if;

  select r.lat, r.lng, r.radius
    into v_lat, v_lng, v_radius
  from public.restaurants r
  where r.id = new.restaurant_id;

  if v_lat is null or v_lng is null or v_radius is null then
    raise exception 'Restaurante invalido o sin geocerca configurada';
  end if;

  if earth_distance(ll_to_earth(v_lat, v_lng), ll_to_earth(new.lat, new.lng)) > v_radius then
    raise exception 'GPS fuera de geocerca';
  end if;

  new.supervisor_id := auth.uid();
  new.recorded_at := coalesce(new.recorded_at, now());
  return new;
end;
$$;

do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'tr_supervisor_presence_guard') then
    drop trigger tr_supervisor_presence_guard on public.supervisor_presence_logs;
  end if;

  create trigger tr_supervisor_presence_guard
  before insert on public.supervisor_presence_logs
  for each row execute function public.trg_supervisor_presence_guard();
end $$;

alter table public.operational_tasks enable row level security;
alter table public.supervisor_presence_logs enable row level security;

revoke all on table public.operational_tasks from public, anon;
revoke all on table public.supervisor_presence_logs from public, anon;

grant select, insert, update on table public.operational_tasks to authenticated;
grant select, insert on table public.supervisor_presence_logs to authenticated;
grant usage, select on sequence public.operational_tasks_id_seq to authenticated;
grant usage, select on sequence public.supervisor_presence_logs_id_seq to authenticated;

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('operational_tasks', 'supervisor_presence_logs')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

create policy operational_tasks_select_hardened
on public.operational_tasks
for select to authenticated
using (
  assigned_employee_id = auth.uid()
  or public.actor_role_secure() = 'super_admin'
  or (public.actor_role_secure() = 'supervisora' and public.is_supervisor_for_restaurant(restaurant_id))
);

create policy operational_tasks_insert_hardened
on public.operational_tasks
for insert to authenticated
with check (
  created_by = auth.uid()
  and (
    public.actor_role_secure() = 'super_admin'
    or (public.actor_role_secure() = 'supervisora' and public.is_supervisor_for_restaurant(restaurant_id))
  )
);

create policy operational_tasks_update_hardened
on public.operational_tasks
for update to authenticated
using (
  assigned_employee_id = auth.uid()
  or public.actor_role_secure() = 'super_admin'
  or (public.actor_role_secure() = 'supervisora' and public.is_supervisor_for_restaurant(restaurant_id))
)
with check (
  assigned_employee_id = auth.uid()
  or public.actor_role_secure() = 'super_admin'
  or (public.actor_role_secure() = 'supervisora' and public.is_supervisor_for_restaurant(restaurant_id))
);

create policy supervisor_presence_select_hardened
on public.supervisor_presence_logs
for select to authenticated
using (
  supervisor_id = auth.uid()
  or public.actor_role_secure() = 'super_admin'
);

create policy supervisor_presence_insert_hardened
on public.supervisor_presence_logs
for insert to authenticated
with check (
  supervisor_id = auth.uid()
  and (
    public.actor_role_secure() = 'super_admin'
    or (public.actor_role_secure() = 'supervisora' and public.is_supervisor_for_restaurant(restaurant_id))
  )
);

commit;

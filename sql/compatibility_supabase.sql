-- Compatibility layer for current frontend contract
-- Date: 2026-02-12

begin;

-- 1) AUDIT LOGS: expected actor_id (frontend) vs existing user_id
alter table public.audit_logs
  add column if not exists actor_id uuid;

update public.audit_logs
set actor_id = user_id
where actor_id is null;

create or replace function public.sync_audit_actor_user()
returns trigger
language plpgsql
as $$
begin
  if new.actor_id is null and new.user_id is not null then
    new.actor_id := new.user_id;
  end if;

  if new.user_id is null and new.actor_id is not null then
    new.user_id := new.actor_id;
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'tr_sync_audit_actor_user'
  ) then
    create trigger tr_sync_audit_actor_user
    before insert or update on public.audit_logs
    for each row execute function public.sync_audit_actor_user();
  end if;
end $$;

-- 2) SHIFTS: status + evidence paths expected by frontend
alter table public.shifts add column if not exists status text;
alter table public.shifts add column if not exists start_evidence_path text;
alter table public.shifts add column if not exists end_evidence_path text;

update public.shifts
set status = case state::text
  when 'activo' then 'active'
  when 'finalizado' then 'completed'
  when 'aprobado' then 'approved'
  when 'rechazado' then 'rejected'
  else state::text
end
where status is null;

create or replace function public.shift_state_to_status(p_state text)
returns text
language sql
immutable
as $$
  select case p_state
    when 'activo' then 'active'
    when 'finalizado' then 'completed'
    when 'aprobado' then 'approved'
    when 'rechazado' then 'rejected'
    else p_state
  end;
$$;

create or replace function public.shift_status_to_state(p_status text)
returns public.shift_state
language plpgsql
immutable
as $$
begin
  case lower(coalesce(p_status, ''))
    when 'active' then return 'activo'::public.shift_state;
    when 'completed' then return 'finalizado'::public.shift_state;
    when 'approved' then return 'aprobado'::public.shift_state;
    when 'rejected' then return 'rechazado'::public.shift_state;
    else
      begin
        return p_status::public.shift_state;
      exception when others then
        return 'activo'::public.shift_state;
      end;
  end case;
end;
$$;

create or replace function public.sync_shift_state_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.state is null and new.status is not null then
      new.state := public.shift_status_to_state(new.status);
    end if;

    if new.status is null and new.state is not null then
      new.status := public.shift_state_to_status(new.state::text);
    end if;

    return new;
  end if;

  if new.status is distinct from old.status and new.status is not null then
    new.state := public.shift_status_to_state(new.status);
  elsif new.state is distinct from old.state and new.state is not null then
    new.status := public.shift_state_to_status(new.state::text);
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'tr_sync_shift_state_status'
  ) then
    create trigger tr_sync_shift_state_status
    before insert or update on public.shifts
    for each row execute function public.sync_shift_state_status();
  end if;
end $$;

-- 3) SHIFT INCIDENTS: expected table name/shape in frontend
create or replace view public.shift_incidents as
select
  i.id,
  i.shift_id,
  i.description as note,
  i.created_at,
  i.created_by
from public.incidents i;

create or replace function public.shift_incidents_insert()
returns trigger
language plpgsql
as $$
declare
  v_row public.incidents;
begin
  insert into public.incidents (shift_id, description, created_by)
  values (
    new.shift_id,
    coalesce(new.note, ''),
    coalesce(new.created_by, auth.uid())
  )
  returning * into v_row;

  new.id := v_row.id;
  new.shift_id := v_row.shift_id;
  new.note := v_row.description;
  new.created_at := v_row.created_at;
  new.created_by := v_row.created_by;
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_trigger where tgname = 'tr_shift_incidents_insert'
  ) then
    drop trigger tr_shift_incidents_insert on public.shift_incidents;
  end if;

  create trigger tr_shift_incidents_insert
  instead of insert on public.shift_incidents
  for each row execute function public.shift_incidents_insert();
end $$;

-- 4) RESTAURANTS: expected geofence_radius_m
alter table public.restaurants
  add column if not exists geofence_radius_m integer;

update public.restaurants
set geofence_radius_m = radius
where geofence_radius_m is null;

create or replace function public.sync_restaurant_radius_columns()
returns trigger
language plpgsql
as $$
begin
  if new.radius is null and new.geofence_radius_m is not null then
    new.radius := new.geofence_radius_m;
  end if;

  if new.geofence_radius_m is null and new.radius is not null then
    new.geofence_radius_m := new.radius;
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'tr_sync_restaurant_radius_columns'
  ) then
    create trigger tr_sync_restaurant_radius_columns
    before insert or update on public.restaurants
    for each row execute function public.sync_restaurant_radius_columns();
  end if;
end $$;

-- 5) RESTAURANT EMPLOYEES (missing in current DB)
create table if not exists public.restaurant_employees (
  id bigserial primary key,
  restaurant_id integer not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

-- 6) USERS/PROFILES compatibility for frontend
alter table public.users
  add column if not exists full_name text;

alter table public.users
  add column if not exists is_active boolean not null default true;

create or replace view public.profiles as
select
  u.id,
  u.full_name,
  u.email,
  r.name::text as role,
  u.is_active
from public.users u
left join public.roles r on r.id = u.role_id;

create or replace function public.profiles_update()
returns trigger
language plpgsql
as $$
declare
  v_role_id integer;
begin
  if new.role is not null then
    select id into v_role_id
    from public.roles
    where name::text = new.role
    limit 1;

    if v_role_id is null then
      raise exception 'Rol invalido: %', new.role;
    end if;
  end if;

  update public.users
  set
    full_name = coalesce(new.full_name, full_name),
    role_id = coalesce(v_role_id, role_id),
    is_active = coalesce(new.is_active, is_active),
    updated_at = now()
  where id = old.id;

  return (
    select p
    from public.profiles p
    where p.id = old.id
  );
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_trigger where tgname = 'tr_profiles_update'
  ) then
    drop trigger tr_profiles_update on public.profiles;
  end if;

  create trigger tr_profiles_update
  instead of update on public.profiles
  for each row execute function public.profiles_update();
end $$;

-- 7) SUPPLIES compatibility columns
alter table public.supplies
  add column if not exists stock integer not null default 0;

alter table public.supplies
  add column if not exists restaurant_id integer references public.restaurants(id) on delete set null;

-- 8) RPC compatibility wrappers expected by frontend
create or replace function public.get_my_active_shift()
returns table (
  id integer,
  start_time timestamptz,
  end_time timestamptz,
  status text
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.start_time, s.end_time, s.status
  from public.shifts s
  where s.employee_id = auth.uid()
    and s.end_time is null
  order by s.start_time desc
  limit 1;
$$;

create or replace function public.start_shift(
  lat double precision,
  lng double precision,
  evidence_path text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_restaurant_id integer;
  v_shift_id integer;
begin
  v_employee_id := auth.uid();

  if v_employee_id is null then
    raise exception 'No autenticado';
  end if;

  select re.restaurant_id
    into v_restaurant_id
  from public.restaurant_employees re
  where re.user_id = v_employee_id
  order by re.id asc
  limit 1;

  if v_restaurant_id is null then
    select r.id into v_restaurant_id
    from public.restaurants r
    order by r.id asc
    limit 1;
  end if;

  if v_restaurant_id is null then
    raise exception 'No hay restaurante configurado para iniciar turno';
  end if;

  v_shift_id := public.start_shift(v_employee_id, v_restaurant_id, lat, lng);

  if evidence_path is not null then
    update public.shifts
    set start_evidence_path = evidence_path,
        updated_at = now()
    where id = v_shift_id;
  end if;

  return v_shift_id;
end;
$$;

create or replace function public.end_shift(
  shift_id integer,
  lat double precision,
  lng double precision,
  evidence_path text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.end_shift(shift_id, lat, lng);

  if evidence_path is not null then
    update public.shifts
    set end_evidence_path = evidence_path,
        updated_at = now()
    where id = shift_id;
  end if;
end;
$$;

-- 9) STORAGE bucket and baseline policies for evidence uploads
insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do nothing;

alter table storage.objects enable row level security;

-- Remove old policies with same names if they exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'evidence_select'
  ) THEN
    DROP POLICY evidence_select ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'evidence_insert'
  ) THEN
    DROP POLICY evidence_insert ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'evidence_update'
  ) THEN
    DROP POLICY evidence_update ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'evidence_delete'
  ) THEN
    DROP POLICY evidence_delete ON storage.objects;
  END IF;
END $$;

create policy evidence_select
on storage.objects
for select
to authenticated
using (bucket_id = 'evidence');

create policy evidence_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'evidence' and owner_id = auth.uid()::text);

create policy evidence_update
on storage.objects
for update
to authenticated
using (bucket_id = 'evidence' and owner_id = auth.uid()::text)
with check (bucket_id = 'evidence' and owner_id = auth.uid()::text);

create policy evidence_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'evidence' and owner_id = auth.uid()::text);

commit;

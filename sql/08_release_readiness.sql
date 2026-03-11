-- 08_release_readiness.sql
-- Ajustes de salida a produccion para frontend administrativo

begin;

-- Restaurantes: soporte de activacion/desactivacion sin borrado fisico
alter table public.restaurants
  add column if not exists is_active boolean not null default true;

create index if not exists idx_restaurants_is_active_name
  on public.restaurants (is_active, name);

-- Insumos: soporte de control de costos
alter table public.supplies
  add column if not exists unit_cost numeric(12,2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supplies_unit_cost_non_negative'
      and conrelid = 'public.supplies'::regclass
  ) then
    alter table public.supplies
      add constraint supplies_unit_cost_non_negative
      check (unit_cost >= 0);
  end if;
end $$;

commit;

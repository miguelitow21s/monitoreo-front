-- RESUMEN ESTRUCTURAL (extraido de compatibility_supabase.sql)
-- Objetivo: version corta para visualizar tablas, relaciones, reglas, triggers y RLS.
-- Fecha: 2026-02-19

begin;

/* =========================================================
   1) TABLAS PRINCIPALES Y CAMPOS CLAVE
   ========================================================= */

-- AUDITORIA
-- public.audit_logs:
--   id, actor_id, user_id, action, created_at, ...

-- OPERACION
-- public.shifts:
--   id, employee_id, restaurant_id, start_time, end_time,
--   start_lat, start_lng, end_lat, end_lng,
--   state, status, start_evidence_path, end_evidence_path,
--   created_at, updated_at

-- public.incidents:
--   id, shift_id, description, created_by, created_at

-- public.scheduled_shifts:
--   id, employee_id, restaurant_id,
--   scheduled_start, scheduled_end,
--   status, notes, started_shift_id, created_by,
--   created_at, updated_at

-- public.restaurant_employees:
--   id, restaurant_id, user_id, created_at

-- CATALOGOS / GESTION
-- public.users:
--   id, email, role_id, full_name, is_active, created_at, updated_at

-- public.roles:
--   id, name

-- public.restaurants:
--   id, name, lat, lng, radius, geofence_radius_m, ...

-- public.supplies:
--   id, name, unit, stock, restaurant_id, ...

-- public.supply_deliveries:
--   id, supply_id, restaurant_id, quantity, delivered_by, delivered_at, ...

-- public.reports:
--   (tabla de reportes operativos)


/* =========================================================
   2) RELACIONES (FK) IMPORTANTES
   ========================================================= */

-- restaurant_employees.restaurant_id -> restaurants.id (ON DELETE CASCADE)
-- restaurant_employees.user_id       -> users.id       (ON DELETE CASCADE)

-- scheduled_shifts.employee_id       -> users.id       (ON DELETE CASCADE)
-- scheduled_shifts.restaurant_id     -> restaurants.id (ON DELETE CASCADE)
-- scheduled_shifts.started_shift_id  -> shifts.id      (ON DELETE SET NULL)
-- scheduled_shifts.created_by        -> users.id       (ON DELETE SET NULL)

-- supplies.restaurant_id             -> restaurants.id (ON DELETE SET NULL)


/* =========================================================
   3) REGLAS / CONSTRAINTS CLAVE
   ========================================================= */

-- scheduled_shifts:
--   check (scheduled_end > scheduled_start)
--   check (status in ('scheduled','started','completed','cancelled'))

-- scheduled_shifts_no_overlap_active (EXCLUDE GIST):
--   evita cruce de horarios activos por employee_id
--   WHERE status in ('scheduled','started')

-- restaurants:
--   check (lat between -90 and 90)
--   check (lng between -180 and 180)
--   check (radius > 0)

-- unique (restaurant_id, user_id) en restaurant_employees

-- indice:
--   idx_scheduled_shifts_employee_start (employee_id, scheduled_start)


/* =========================================================
   4) VISTAS DE COMPATIBILIDAD
   ========================================================= */

-- public.shift_incidents:
--   SELECT id, shift_id, description AS note, created_at, created_by FROM incidents

-- public.profiles:
--   SELECT users + join roles para exponer role como texto


/* =========================================================
   5) TRIGGERS Y FUNCIONES TRIGGER
   ========================================================= */

-- tr_sync_audit_actor_user ON audit_logs
--   fn: public.sync_audit_actor_user()
--   sincroniza actor_id <-> user_id

-- tr_sync_shift_state_status ON shifts
--   fn: public.sync_shift_state_status()
--   sincroniza state(enum) <-> status(text)

-- tr_shift_incidents_insert ON shift_incidents (INSTEAD OF INSERT)
--   fn: public.shift_incidents_insert()
--   redirige inserts a incidents

-- tr_sync_restaurant_radius_columns ON restaurants
--   fn: public.sync_restaurant_radius_columns()
--   sincroniza radius <-> geofence_radius_m

-- tr_profiles_update ON profiles (INSTEAD OF UPDATE)
--   fn: public.profiles_update()
--   actualiza users desde la vista profiles

-- tr_supply_deliveries_defaults ON supply_deliveries
--   fn: public.set_supply_delivery_defaults()
--   asigna delivered_at/delivered_by por defecto


/* =========================================================
   6) RPC / FUNCIONES DE NEGOCIO
   ========================================================= */

-- Registro / identidad
--   public.register_employee(p_user_id, p_email, p_full_name)
--   public.app_user_role(p_user_id)
--   public.current_actor_role()

-- Turnos programados
--   public.assign_scheduled_shift(...)
--   public.list_my_scheduled_shifts(p_limit)
--   public.list_scheduled_shifts(p_limit)

-- Turnos operativos
--   public.get_my_active_shift()
--   public.start_shift(employee_id, restaurant_id, lat, lng)            -- core
--   public.end_shift(shift_id, lat, lng)                                -- core
--   public.start_shift(lat, lng, evidence_path default null)            -- wrapper frontend
--   public.end_shift(shift_id, lat, lng, evidence_path default null)    -- wrapper frontend


/* =========================================================
   7) STORAGE (EVIDENCE)
   ========================================================= */

-- Bucket esperado: storage.buckets.id = 'evidence' (privado)
-- Policies creadas para storage.objects:
--   evidence_select
--   evidence_insert
--   evidence_update
--   evidence_delete


/* =========================================================
   8) RLS HABILITADO EN
   ========================================================= */

-- users
-- restaurants
-- restaurant_employees
-- shifts
-- incidents
-- scheduled_shifts
-- audit_logs
-- supplies
-- supply_deliveries
-- reports


/* =========================================================
   9) MATRIZ DE POLICIES (NOMBRES)
   ========================================================= */

-- users:
--   users_select_self_or_admin
--   users_update_admin

-- restaurants:
--   restaurants_select_authenticated
--   restaurants_write_super_admin

-- restaurant_employees:
--   restaurant_employees_select_scoped
--   restaurant_employees_write_admin

-- shifts:
--   shifts_select_by_role
--   shifts_update_supervision

-- incidents:
--   incidents_select_by_role
--   incidents_insert_scoped
--   incidents_update_supervision

-- scheduled_shifts:
--   scheduled_shifts_select_by_role
--   scheduled_shifts_write_supervision

-- audit_logs:
--   audit_logs_select_supervision

-- supplies:
--   supplies_select_supervision
--   supplies_write_supervision

-- supply_deliveries:
--   supply_deliveries_select_supervision
--   supply_deliveries_insert_supervision

-- reports:
--   reports_select_supervision
--   reports_write_super_admin

commit;

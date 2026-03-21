# Backend Handoff - Flujos por perfil (Empleado / Supervisora / Super Admin)

Fecha: 2026-03-20  
Proyecto: `monitoreo-front`

Objetivo: documentar todos los metodos, logica y encabezados que el frontend usa con backend/Edge Functions para los tres perfiles. Todo lo listado aqui ya se consume desde el frontend actual.

---

## 1) Encabezados y seguridad comunes

1. Todas las Edge Functions se invocan por `POST /functions/v1/{fn}` (Supabase Edge).
2. Encabezados base (siempre):
   - `Authorization: Bearer <access_token>`
   - `apikey: <SUPABASE_ANON_KEY>`
   - `Content-Type: application/json`
   - `x-device-fingerprint: <fingerprint>` (siempre lo agrega `invokeEdge`)
3. Encabezados adicionales (segun flujo):
   - `Idempotency-Key: <uuid>` para evitar duplicados (siempre se manda en acciones sensibles).
   - `x-shift-otp-token: <otp_token>` requerido para iniciar/terminar turnos y subir evidencia.
4. Device binding:
   - `trusted_device_validate` + `trusted_device_register` se llaman automaticamente al iniciar flujos sensibles.
5. OTP de telefono:
   - `phone_otp_send` y `phone_otp_verify` se usan para generar el `x-shift-otp-token`.
6. `health_ping` es solo **GET** (no POST).

---

## 2) Perfil Empleado

### A) Autenticacion + consentimiento legal

1. `legal_consent` (Edge)
   - `action: "status"` para validar aceptacion vigente.
   - `action: "accept"` para registrar aceptacion.
   - Requiere `Authorization`, `apikey`, `x-device-fingerprint`, `Idempotency-Key` (accept).

### B) OTP de telefono (obligatorio antes de iniciar/terminar turno)

1. `phone_otp_send` (Edge)
   - Body: `{ device_fingerprint }`
   - Respuesta esperada (modo `OTP_SCREEN_MODE=true`):
     - `debug_code` siempre presente, `delivery_status="screen"`.
     - `masked_phone` puede ser `"OTP en pantalla"` si no hay `phone_e164`.
     - `phone_e164` es opcional en este modo.
2. `phone_otp_verify` (Edge)
   - Body: `{ code, device_fingerprint }`
   - Respuesta: `verification_token` (se guarda como `x-shift-otp-token`).

### C) Turno: inicio / evidencia / fin

1. `shifts_start` (Edge)
   - Headers: `x-shift-otp-token`, `x-device-fingerprint`
   - Body:
     - `restaurant_id`
     - `lat`, `lng`
     - `fit_for_work` (boolean)
     - `declaration` (string|null)
     - `scheduled_shift_id` (opcional)
   - Respuesta esperada (envelope):
     - `data = { shift_id, pending_tasks_count, pending_tasks_preview }`
2. Evidencia de turno (inicio/fin) via `evidence_upload` (Edge)
   - `action: "request_upload"`: `{ shift_id, type: "inicio"|"fin" }`
     - Respuesta esperada (envelope):
       - `data.upload` (incluye `signedUrl` o `token`)
       - `bucket`, `path`, `max_bytes`, `allowed_mime`
   - Upload binario:
     - PUT a `signedUrl` o `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)`
   - `action: "finalize_upload"`:
     - `{ shift_id, type, path, lat, lng, accuracy, captured_at, meta }`
     - Respuesta esperada (envelope):
       - `data = { shift_id, type, storage_path, sha256 }`
3. `shifts_end` (Edge)
   - Headers: `x-shift-otp-token`, `x-device-fingerprint`
   - Body:
     - `shift_id`
     - `lat`, `lng`
     - `fit_for_work` (boolean)
     - `declaration` (string|null)
     - `early_end_reason` (opcional)
   - Respuesta esperada (envelope): `data = {}`

### D) Consulta de turnos (RPC / DB)

1. `get_my_active_shift` (RPC)
2. `shifts` table: historial por `employee_id`

### E) Dashboard empleado

1. `employee_self_service` (Edge)
   - `action: "my_dashboard"` (restaurantes asignados, turnos programados, tareas pendientes, shift activo).
   - `action: "my_hours_history"` (historial horas).
   - `action: "create_observation"` (observaciones/alertas).

### F) Tareas operativas (empleado)

1. `operational_tasks_manage` (Edge)
   - `action: "list_my_open"` (listar tareas abiertas).
     - Respuesta esperada (envelope): `data.items`
   - `action: "complete"` con `task_id` + `evidence_path`.
     - Respuesta esperada (envelope): `data.task_id`
   - `action: "request_evidence_upload"` (subir evidencia foto).
   - `action: "request_manifest_upload"` (evidencia compuesta).
2. **Evitar writes directos a DB desde frontend**. Si se mantiene un fallback DB:
   - Debe respetar RLS y constraints.
   - Validar que exista un endpoint equivalente en backend para esos writes.

---

## 3) Perfil Supervisora

### A) Control de turnos

1. Listado turnos activos (DB)
   - `shifts` table (end_time IS NULL).
2. Cambios de estado (Edge)
   - `shifts_approve` o `shifts_reject`
   - Headers: `x-shift-otp-token` + `x-device-fingerprint`
3. Incidentes de turno (Edge)
   - `incidents_create` con `{ shift_id, description }`
   - Headers: `x-shift-otp-token` + `x-device-fingerprint`

### B) Programacion de turnos

1. `scheduled_shifts_manage` (Edge)
   - `action: "list"` (con `status: "scheduled"`, `limit`, `restaurant_id` opcional)
   - `action: "assign"` (asignar un turno)
   - `action: "bulk_assign"` (lotes)
     - Respuesta esperada (envelope):
       - `data = { total, created, failed, created_ids, errors }`
   - `action: "reschedule"`
   - `action: "cancel"`

### C) Restaurantes y personal

1. `restaurant_staff_manage` (Edge)
   - `action: "list_by_restaurant"`
   - `action: "assign_employee" | "unassign_employee"`
2. `admin_supervisors_manage` **NO aplica a supervisora** (solo super_admin).
3. `admin_restaurants_manage` **NO aplica a supervisora** (solo super_admin).

### D) Supervisiones en sitio (presencia)

1. Upload evidencia (Storage)
   - `uploadEvidenceObject(filePath, blob)` -> bucket `evidence`/`shift-evidence`.
2. **Evitar writes directos a DB desde frontend** (por ejemplo `supervisor_presence_logs`).
   - Si se mantiene fallback DB: RLS + constraints obligatorios.

### E) Tareas operativas (supervisora)

1. `operational_tasks_manage` (Edge)
   - `action: "list_supervision"` (con `restaurant_id` opcional)
   - `action: "create"` (crear tarea)
   - `action: "complete"` (cerrar con evidencia)
   - `action: "request_evidence_upload"` / `request_manifest_upload`
2. DB directa (Supabase)
   - `operational_tasks` update (editar detalles, cerrar/cancelar, delete).

### F) Reportes

1. `reports_generate` (Edge)
   - Body: `{ restaurant_id, period_start, period_end }`
2. `reports` table (historial, fallback).

---

## 4) Perfil Super Admin

El Super Admin reutiliza todo lo de Supervisora y suma administracion global:

1. `admin_users_manage` (Edge)
   - `action: "list" | "update" | "activate" | "deactivate" | "create"`
2. `admin_restaurants_manage` (Edge)
   - `action: "list" | "create" | "update" | "activate" | "deactivate"`
3. `admin_dashboard_metrics` (Edge) si se usa tablero ejecutivo.
4. `reports_generate` (Edge) y consultas a `reports` para auditoria.

---

## 5) Notas de compatibilidad

1. Varios endpoints tienen fallback a lectura directa en tablas Supabase si falla Edge (CORS/404).
2. El frontend espera respuestas en envelope `{ success, data, error, request_id }` en Edge.
3. El `x-device-fingerprint` se envia en todos los llamados Edge; el backend debe aceptarlo y registrarlo.
4. Ventana de 30 min eliminada: se permite iniciar cualquier turno programado **no vencido**. Si hay varios, enviar `scheduled_shift_id`.

# Backend Handoff - Flujos por perfil (Empleado / Supervisora / Super Admin)

Fecha: 2026-03-20  
Proyecto: `monitoreo-front`

Objetivo: documentar todos los metodos, logica y encabezados que el frontend usa con backend/Edge Functions para los tres perfiles. Todo lo listado aqui ya se consume desde el frontend actual.

---

## 1) Encabezados y seguridad comunes

1. Todas las Edge Functions se invocan por `POST /functions/v1/{fn}` (Supabase Edge).
   - Excepcion: `GET /health_ping`.
2. Encabezados base (siempre, **todas** las Edge):
   - `Authorization: Bearer <access_token>`
   - `apikey: <SUPABASE_ANON_KEY>`
   - `Content-Type: application/json`
   - `Idempotency-Key: <uuid>`
   - `x-device-fingerprint: <string >= 16 chars>` (siempre lo agrega `invokeEdge`)
3. Encabezados adicionales (segun flujo):
   - `x-shift-otp-token: <otp_token>` requerido para iniciar/terminar turnos y subir evidencia.
4. Device binding:
   - `trusted_device_validate` + `trusted_device_register` se llaman automaticamente al iniciar flujos sensibles.
5. OTP de telefono:
   - `phone_otp_send` y `phone_otp_verify` se usan para generar el `x-shift-otp-token`.

### A) Perfil y rol (todos los perfiles)

1. `users_manage` (Edge)
   - `action: "me"` retorna `{ id, email, role, is_active, first_name, last_name, full_name, phone_e164 }`.
2. `users_bootstrap` (Edge, **fallback**)
   - Request: `POST /functions/v1/users_bootstrap`
   - Body: `{ "action": "bootstrap_my_user" }`
   - Respuesta: `{ success, data: { id, email, role, is_active, ... }, error, request_id }`
   - Mantener como fallback si `users_manage` falla; no rompe el flujo.

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
3. Evidencia de turno (listado) via `shift_evidence_manage` (Edge)
   - Request: `POST /functions/v1/shift_evidence_manage`
   - Body: `{ "action": "list_by_shift", "shift_id": <id>, "type": "inicio"|"fin"|null, "limit": 50 }`
   - Respuesta: `{ success, data: { items: [ { id, shift_id, type, storage_path, captured_at, lat, lng } ] }, error, request_id }`
   - Notas:
     - Bucket: `shift-evidence`.
     - Si no hay fotos, `items` viene vacío → mostrar “sin evidencia”.
     - Si hay múltiples fotos, mostrar galería por `type` (inicio/fin).
4. `shifts_end` (Edge)
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
   - `action: "my_active_shift"` (turno activo del empleado).
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

1. Listado turnos activos (Edge)
   - Request: `POST /functions/v1/shifts_manage`
   - Body: `{ "action": "list_active", "restaurant_id": <id?>, "limit": 50 }`
   - Respuesta: `{ success, data: { items: [ { id, employee_id, restaurant_id, start_time, status, start_evidence_path?, end_evidence_path? } ] }, error, request_id }`
2. Cambios de estado (Edge)
   - `shifts_approve` o `shifts_reject`
   - Headers: `x-shift-otp-token` + `x-device-fingerprint`
3. Incidentes de turno (Edge)
   - `incidents_create` con `{ shift_id, description }`
   - Headers: `x-shift-otp-token` + `x-device-fingerprint`
4. Listado de incidentes por turno (Edge)
   - Request: `POST /functions/v1/incidents_manage`
   - Body: `{ "action": "list_by_shift", "shift_id": <id> }`
   - Respuesta: `{ success, data: { items: [ { id, shift_id, note, created_at } ] }, error, request_id }`

### B) Programacion de turnos

1. `scheduled_shifts_manage` (Edge)
   - `action: "list"` (acepta `status`, `limit`, `restaurant_id` opcional, `from/to` ISO opcionales)
     - Si se omite `restaurant_id` → devuelve TODO el scope del usuario (supervisora).
     - No filtra solo a futuro por defecto; para alertas usar `status=scheduled` + `from/to` del día.
     - Ejemplo alertas:
       ```
       { "action": "list", "status": "scheduled", "from": "2026-03-24T00:00:00.000Z", "to": "2026-03-24T23:59:59.999Z" }
       ```
   - `action: "assign"` (asignar un turno)
   - `action: "bulk_assign"` (lotes)
     - Respuesta esperada (envelope):
       - `data = { total, created, failed, created_ids, errors }`
   - `action: "reschedule"`
   - `action: "cancel"`

### C) Restaurantes y personal

1. `restaurant_staff_manage` (Edge)
   - `action: "list_my_restaurants"`
   - `action: "list_assignable_employees"`
   - `action: "list_by_restaurant"`
   - `action: "assign_employee" | "unassign_employee"`
2. `admin_supervisors_manage` **NO aplica a supervisora** (solo super_admin).
3. `admin_restaurants_manage` **NO aplica a supervisora** (solo super_admin).

### D) Supervisiones en sitio (presencia)

1. Upload evidencia (Storage)
   - `uploadEvidenceObject(filePath, blob)` -> bucket `evidence`/`shift-evidence`.
2. `supervisor_presence_manage` (Edge)
   - `action: "register"`
   - `action: "list_my"`
   - `action: "list_by_restaurant"` (opcional `from/to` en ISO).

### E) Tareas operativas (supervisora)

1. `operational_tasks_manage` (Edge)
   - `action: "list_supervision"` (con `restaurant_id` opcional)
   - `action: "create"` (crear tarea)
   - `action: "update"` (editar detalles)
   - `action: "cancel"` (cancelar sin evidencia)
   - `action: "mark_in_progress"`
   - `action: "close"` (cerrar sin evidencia)
   - `action: "complete"` (cerrar con evidencia)
   - `action: "request_evidence_upload"` / `request_manifest_upload`

### F) Reportes

1. `reports_manage` (Edge)
   - `action: "list_shifts"` (requiere `from/to` en ISO)
   - `action: "list_history"`
2. `reports_generate` (Edge, export CSV/PDF)
   - Request: `POST /functions/v1/reports_generate`
   - Body:
     ```
     {
       "restaurant_id": <id>,
       "period_start": "YYYY-MM-DD",
       "period_end": "YYYY-MM-DD",
       "columns": [ ...campos ],
       "export_format": "csv" | "pdf" | "both"
     }
     ```
   - Campos soportados:
     `shift_id`, `employee_id`, `employee_name`, `restaurant_id`, `restaurant_name`,
     `start_time`, `end_time`, `hours_worked`, `state`, `status`,
     `approved_by`, `approved_by_name`, `rejected_by`, `rejected_by_name`,
     `start_evidence_path`, `end_evidence_path`.
   - Notas:
     - PDF sale en formato tabla con encabezados legibles.
     - CSV usa encabezados legibles.
     - El orden respeta exactamente el array `columns`.
     - Si `columns` incluye campos no soportados, backend devuelve 422 con la lista valida.
   - Respuesta: `{ success, data: { report_id, url_pdf?, url_csv? }, error, request_id }`

---

## 4) Perfil Super Admin

El Super Admin reutiliza todo lo de Supervisora y suma administracion global:

1. `admin_users_manage` (Edge)
   - `action: "list" | "update" | "activate" | "deactivate" | "create"`
2. `admin_restaurants_manage` (Edge)
   - `action: "list" | "create" | "update" | "activate" | "deactivate"`
3. `admin_dashboard_metrics` (Edge) si se usa tablero ejecutivo.
4. `reports_manage` (Edge)
   - `action: "list_shifts"` (requiere `from/to` en ISO)
   - `action: "list_history"`
5. `audit_logs_manage` (Edge)
   - `action: "list"`
6. `supervisor_presence_manage` (Edge)
   - `action: "list_today"` (opcional `from/to` en ISO para timezone correcto; default America/Bogota).
7. `reports_generate` (Edge, export CSV/PDF)
   - Request: `POST /functions/v1/reports_generate`
   - Body:
     `{ "restaurant_id": <id>, "period_start": "YYYY-MM-DD", "period_end": "YYYY-MM-DD", "columns": [ ...campos ], "export_format": "csv" | "pdf" | "both" }`
   - Campos soportados:
     `shift_id`, `employee_id`, `employee_name`, `restaurant_id`, `restaurant_name`,
     `start_time`, `end_time`, `hours_worked`, `state`, `status`,
     `approved_by`, `approved_by_name`, `rejected_by`, `rejected_by_name`,
     `start_evidence_path`, `end_evidence_path`.
   - Notas:
     - PDF sale en formato tabla con encabezados legibles.
     - CSV usa encabezados legibles.
     - El orden respeta exactamente el array `columns`.
     - Si `columns` incluye campos no soportados, backend devuelve 422 con la lista valida.
   - Respuesta: `{ success, data: { report_id, url_pdf?, url_csv? }, error, request_id }`

---

## 5) Notas de compatibilidad

1. Varios endpoints tienen fallback a lectura directa en tablas Supabase si falla Edge (CORS/404).
2. El frontend espera respuestas en envelope `{ success, data, error, request_id }` en Edge.
3. El `x-device-fingerprint` se envia en todos los llamados Edge; el backend debe aceptarlo y registrarlo.
4. Ventana de 30 min eliminada: se permite iniciar cualquier turno programado **no vencido**. Si hay varios, enviar `scheduled_shift_id`.
5. Errores tipicos:
   - `405`: metodo incorrecto (debe ser POST).
   - `422`: falta `Idempotency-Key` o payload invalido.
   - `403`: rol sin acceso al restaurante o accion.

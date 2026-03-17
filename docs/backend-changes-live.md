# Backend Changes - Live Handoff

Date: 2026-03-10
Project: `monitoreo-front`

## Purpose
This file is the single source of truth for backend-impacting changes requested by frontend during this delivery cycle.
It will be updated incrementally on each new change.

## Pending Review By Backend

### 1) Restaurants soft activation/deactivation
- Context: Super Admin now supports activate/deactivate in frontend instead of delete flow.
- Required DB changes:
  - Add column `public.restaurants.is_active boolean not null default true`.
  - Add index `idx_restaurants_is_active_name` on `(is_active, name)`.
- Expected behavior:
  - Active restaurants shown by default.
  - Inactive restaurants remain in history/audit but excluded from default operational lists.

### 2) Supply unit cost support (operational cost control)
- Context: Frontend now captures and displays supply unit cost and estimated inventory cost.
- Required DB changes:
  - Add column `public.supplies.unit_cost numeric(12,2) not null default 0`.
  - Add check constraint `supplies_unit_cost_non_negative` with `unit_cost >= 0`.
- Expected behavior:
  - Delivery/cost metrics consume `unit_cost` without null/negative values.

### 3) Shift evidence tagging by area/subarea (new UI flow)
- Context: Employee/Supervisora shift flow now requiere multiples fotos de inicio y fin, cada foto clasificada por **area** + **subarea** del restaurante.
- Objetivo: permitir control de calidad y auditoria por zona (cocina, comedor, baños, etc.).
- Propuesta de payload adicional en `POST /evidence_upload` (finalize_upload):
  - `meta`: objeto JSON opcional con:
    - `area_key` (string)
    - `subarea_key` (string)
    - `area_label` (string)
    - `subarea_label` (string)
    - `sequence` (number) orden de captura
    - `phase` ("inicio" | "fin")
    - `capture_source` ("camera")
- Backend recomendado:
  - Persistir `meta` en `shift_photos` (columna JSONB) o columnas dedicadas.
  - Si no se puede persistir, al menos aceptar el campo y no fallar la solicitud.
- Lista base de areas/subareas (frontend):
  - Cocina: Campana, Pisos, Esquinas, Detrás de freidoras, Debajo de mesas, Frente de neveras
  - Comedor: General, Pisos, Esquinas, Debajo de mesas y asientos, Marcos de ventanas
  - Puntos de dispensadores de gaseosas: Frente, Atrás, Gabinetes
  - Desagües: General
  - Fachadas - patios: Pisos, Esquinas, Debajo de mesas y asientos, Marcos de las ventanas
  - Baños: Pisos, Sanitarios adelante, Sanitarios atrás, Lavamanos, Cambiador de niños, Puertas y marcos
  - Otro: texto libre en frontend (solo si aplica)
- Observacion:
  - Si backend puede proveer esta matriz por restaurante, frontend puede reemplazar el catalogo fijo.

## Proposed Migration Script
- File prepared by frontend: `sql/08_release_readiness.sql`
- Status: `pending backend approval`

## Notes
- Frontend includes compatibility fallback for `restaurants.is_active` missing column in list queries.
- Full functionality (restaurant activation and cost metrics) requires backend to apply the migration.

## Backend Validation Checklist (End-to-End Sign-off)
Use this checklist so backend can validate the complete flow in one pass, including shift access and operational controls.

### A) Access and roles (critical)
- Validate role access to `/shifts` and related data:
  - `empleado`: can start/end own shift, view own history and assigned schedule.
  - `supervisora`: can view active shifts, register supervisor presence, create incidents/tasks, supervise scheduled shifts.
  - `super_admin`: full visibility and control across modules.
- Confirm RLS/policies prevent cross-user data leaks (employee should not read/write other employees' shifts/tasks/evidence).

### B) Shift integrity and attendance hardening
- Confirm backend remains authoritative for attendance timestamp (`server time`) on start/end operations.
- Validate geofence enforcement server-side against assigned restaurant coordinates/radius.
- Validate anti-spoof controls server-side (mocked/suspicious GPS and low-quality location handling policy).
- Ensure single active shift per employee is enforced (`no overlapping active shift`).

### C) Evidence and storage
- Validate start/end shift evidence upload + finalize flow (`evidence_upload` and storage object path integrity).
- Validate task evidence closure flow (triple evidence manifest for close/mid/wide shots).
- Validate supervisor presence evidence flow and signed URL read access rules.

### D) Scheduling and supervision flows
- Validate `scheduled_shifts` contracts used by frontend:
  - assign single shift
  - assign bulk shifts
  - reprogram shift
  - cancel shift
- Confirm status transitions are consistent (`scheduled`, `cancelled`, etc.) and auditable.

### E) Reports and audits
- Validate report queries across `shifts`, `shift_incidents`, and `scheduled_shifts` include:
  - filters by period, restaurant, employee, supervisor, status
  - evidence path resolution for signed read-only links
- Validate report history retrieval from `reports` table (`generated_at`, `generado_por`, `filtros_json`, `file_path`, `hash_documento`).

### F) Supplies and operational expenses
- Validate `supplies.unit_cost` availability and non-negative constraint (`>= 0`).
- Validate `supply_deliveries` consumption by period and restaurant (`quantity`, `delivered_at`).
- Validate operational expense reports (restaurant/period aggregation) used by frontend CSV/PDF outputs.

### G) Pending DB actions to unlock full production behavior
- Apply `sql/08_release_readiness.sql` (pending approval):
  - `restaurants.is_active`
  - `supplies.unit_cost` + constraint
- Re-run smoke test after migration on: restaurants activation, supplies costs, dashboard cost metrics, supplies analytics.

## Update Log
- 2026-03-10: File initialized and first two backend change requests documented.
- 2026-03-10: Frontend added scheduled shift controls (bulk scheduling, cancel, reschedule) for Super Admin and Supervision panel.
- 2026-03-10: No new backend schema change requested for scheduled shift controls; implementation uses existing `scheduled_shifts` contracts/policies.
- 2026-03-10: Employee shift UX updated (health/work-capacity checklist at start/end, clearer assigned schedule, clearer worked-hours history). No new backend schema required.
- 2026-03-10: Attendance hardening added in frontend (GPS accuracy threshold, mocked/suspicious location block, geofence precheck against assigned restaurant, and evidence accuracy forwarding on start/end).
- 2026-03-10: No new schema requested for attendance hardening. Backend/Edge should remain authoritative for final validation (server timestamp, geofence enforcement, anti-spoof policy) even when frontend prechecks pass.
- 2026-03-10: UI language consistency review executed (employee/supervision shifts flow and shared table component). No new backend schema or API contract changes required.
- 2026-03-10: Backend approval pending remains limited to prior items (`restaurants.is_active`, `supplies.unit_cost`) and any existing Edge authoritative validations already documented.
- 2026-03-10: Fraud-prevention evidence hardening updated in frontend: camera-only capture flow maintained (no gallery upload path), visible on-photo metadata reinforced (captured datetime, user/employee, GPS location, restaurant, shift/phase) across shift start/end, task evidence, and supervisor presence captures.
- 2026-03-10: Storage remains in secure cloud buckets via Supabase Storage upload flows (`evidence_upload` and `uploadEvidenceObject`). No additional schema change required for this frontend update.
- 2026-03-10: Super User reports module expanded for client/audit support: selectable fields now include supervisor and start/end evidence by default, added supervisor filter, client/restaurant filter wording clarified, and report results can open read-only evidence links (initial/final photos) directly.
- 2026-03-10: Report UI now renders human-readable names for restaurant/employee/supervisor (instead of raw IDs) using existing catalogs; CSV export uses same readable values for those dimensions.
- 2026-03-10: No new backend schema required for this reports enhancement. It reuses existing `shifts`, `shift_incidents`, `scheduled_shifts`, `reports`, and storage signed URL flows.
- 2026-03-10: Supplies module expanded for Coordinadora/Supervisora and full Super User visibility with operational expense control: delivery registration now supports explicit delivery datetime, period/restaurant analytics, historical consumption by supply and restaurant, atypical consumption detection, and CSV expense report by restaurant and period.
- 2026-03-10: No new backend schema required for this supplies/gastos enhancement. It reuses existing `supplies` (`unit_cost`) and `supply_deliveries` (`quantity`, `delivered_at`) contracts.
- 2026-03-10: Supplies operational reporting now includes printable PDF export (browser print/save as PDF) for the same period/restaurant expense breakdown used in CSV export.
- 2026-03-10: No backend API or schema changes required for this PDF export enhancement.
- 2026-03-10: Frontend aligned shift Edge requests with backend security requirements for `shifts_start` and `shifts_end`: enforced `Authorization` bearer from current session, generated `Idempotency-Key`, and attached `x-device-fingerprint` + `x-shift-otp-token` headers on every request.
- 2026-03-10: Frontend now blocks start/end shift calls when shift OTP token is missing and returns explicit guidance to complete phone OTP verification first.
- 2026-03-10: Employee shifts UI now includes in-flow OTP controls (`phone_otp_send` and `phone_otp_verify`) with device fingerprint binding, local OTP token persistence, and submit blockers when OTP is pending.
- 2026-03-10: Scheduling service migrated to `scheduled_shifts_manage` (`assign`, `bulk_assign`, `reschedule`, `cancel`, `list`) with upcoming-only filtering preserved in frontend.
- 2026-03-10: Operational tasks service migrated to `operational_tasks_manage` for `create`, `list_my_open`, `list_supervision`, `complete`; task manifest upload now uses `request_manifest_upload` signed token flow.
- 2026-03-10: Incidents creation migrated to `incidents_create` endpoint contract (`shift_id`, `description`) for employee/supervision notes.
- 2026-03-10: Reports backend generation updated to consume signed URLs (`url_pdf`, `url_excel`) from `reports_generate` and open outputs directly when present.
- 2026-03-10: Evidence upload client now supports new `evidence_upload` request payload shape (`upload.token`, `upload.path`, `bucket`) with backward compatibility to URL-based upload responses.
- 2026-03-10: Edge client now appends `request_id` to surfaced error messages for support/debug traceability.
- 2026-03-16: Frontend new shift UI requires multiple start/end photos tagged by area/subarea; proposed `meta` payload for `evidence_upload finalize_upload` and optional backend persistence.

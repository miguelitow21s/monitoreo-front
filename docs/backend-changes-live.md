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

## Proposed Migration Script
- File prepared by frontend: `sql/08_release_readiness.sql`
- Status: `pending backend approval`

## Notes
- Frontend includes compatibility fallback for `restaurants.is_active` missing column in list queries.
- Full functionality (restaurant activation and cost metrics) requires backend to apply the migration.

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

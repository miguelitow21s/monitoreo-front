Backend validation checklist (post-frontend fixes)

1) Run the updated SQL migration:
- File: `sql/compatibility_supabase.sql`
- It now includes:
  - `public.bootstrap_my_user()` RPC.
  - Extended `public.register_employee(...)` parameters (`first_name`, `last_name`, `phone_number`).
  - New optional restaurant address columns.
  - `cube` and `earthdistance` extensions for geofence distance functions.
  - Storage compatibility for both buckets: `evidence` and `shift-evidence`.
  - Conditional RLS/policies for `operational_tasks` and `supervisor_presence_logs`.

2) Confirm RPC contracts:
- `register_employee` accepts both legacy and extended registration payloads.
- `bootstrap_my_user` is executable by `authenticated`.

3) Confirm storage:
- Buckets available: `evidence` and/or `shift-evidence`.
- Policies allow authenticated owner upload/read/update/delete for both bucket ids.

4) Confirm role/policy behavior:
- Employees can read/update only their operational tasks.
- Supervisors/super_admin can create/manage operational tasks.
- Supervisor presence logs allow scoped read and supervisor-owned inserts.

5) Validate critical end-to-end flows:
- Register -> email confirm (if enabled) -> first login -> profile bootstraps automatically.
- Start shift / end shift with geofence validation.
- Evidence upload and signed URL resolution works regardless of active bucket.
- Restaurant creation with address search + map selected coordinates.

6) Validate edge functions (if deployed separately):
- `shifts_start`, `shifts_end`, `evidence_upload`, `reports_generate`, `legal_consent`.
- Ensure no contract regression with current frontend payloads.

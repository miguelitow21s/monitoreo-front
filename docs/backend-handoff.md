# Backend Handoff - Required Work

Date: March 5, 2026  
Project: `monitoreo-front`

## 1) Device Binding on First Login (Mandatory)

Goal: user can only access from the first approved device unless re-approved by admin/supervisor.

Required backend changes:

1. Create table `public.user_trusted_devices`:
   - `id bigserial primary key`
   - `user_id uuid not null references auth.users(id) on delete cascade`
   - `device_fingerprint text not null`
   - `device_name text null`
   - `first_seen_at timestamptz not null default now()`
   - `last_seen_at timestamptz not null default now()`
   - `is_active boolean not null default true`
   - unique (`user_id`, `device_fingerprint`)

2. Create RPC/Edge endpoints:
   - `auth_register_device(device_fingerprint text, device_name text)`:
     first login registers device if none exists.
   - `auth_validate_device(device_fingerprint text)`:
     blocks session usage if fingerprint is not trusted.
   - `auth_revoke_device(device_id bigint)` and `auth_list_devices(user_id uuid)` for admin panel.

3. Enforce check:
   - On login/session bootstrap, backend must deny access to protected operations if device is untrusted.

## 2) Phone Verification / Account Ownership Hardening

Goal: reduce credential sharing and impersonation.

Required backend changes:

1. Add `phone` and `phone_verified_at` to `public.users` (or linked profile table).
2. Add OTP verification flow (SMS provider).
3. Block shift start/end if phone not verified.
4. Add endpoint:
   - `auth_send_phone_otp(phone)`
   - `auth_verify_phone_otp(code)`

## 3) Email Notifications

Goal: notify relevant actors automatically.

Required notifications:

1. Shift scheduled (employee + supervisor).
2. Shift start and shift end confirmation.
3. Missed shift start window.
4. Incident created.
5. Shift approved/rejected.

Required backend changes:

1. Event trigger layer (DB trigger or event bus) for:
   - `scheduled_shifts` inserts/updates
   - `shifts` status transitions
   - `incidents` inserts
2. Queue table `notification_jobs` + worker/cron.
3. Email templates in English for US client.

## 4) Restaurant Address + Map Support

Goal: avoid manual coordinate entry.

Required backend changes:

1. Add columns to `public.restaurants`:
   - `address_line text null`
   - `city text null`
   - `state text null`
   - `postal_code text null`
   - `country text null`
   - `place_id text null`

2. Keep lat/lng/radius validation as mandatory for geofence logic.
3. Optional server-side geocoding endpoint:
   - `restaurants_geocode(address text)` to return normalized address + coordinates.

## 5) Security and Audit

1. Audit all sensitive actions:
   - device registration/revocation
   - phone verification
   - login blocked by untrusted device
2. Expose read models for admin dashboard:
   - blocked logins
   - unverified users
   - pending notification failures

## 6) API Contracts Frontend Needs Next

1. `POST /auth/device/validate`
2. `POST /auth/device/register`
3. `POST /auth/phone/send-otp`
4. `POST /auth/phone/verify-otp`
5. `POST /notifications/test`
6. `POST /restaurants/geocode`

## 7) Acceptance Criteria

1. Untrusted device cannot start/end shifts.
2. New device login requires explicit approval flow.
3. Phone verification required before first operational action.
4. Notification events emitted for all listed scenarios.
5. Restaurant creation works with address input and stored normalized address fields.

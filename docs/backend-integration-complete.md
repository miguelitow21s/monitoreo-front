# Backend Integration Completa (Frontend ⇄ Edge Functions)

Fecha: 2026-03-18

Este documento consolida **todos los contratos, headers, métodos y flujos** que el frontend usa para operar el sistema. Está pensado como **fuente única** para el backend y para validación end‑to‑end.

---

## 0) Alcance y principios
- **Roles cubiertos**: Empleado, Supervisora, Super Admin.
- **Autenticación**: Supabase Auth (email/usuario + contraseña).
- **Todas las Edge Functions** usan `POST` (excepto `GET /health_ping`).
- **Idempotencia**: cada request a Edge Functions lleva `Idempotency-Key` único.
- **OTP**: obligatorio para operaciones sensibles (turnos, evidencias, aprobaciones, incidentes).
- **Envelope estándar**: todas las Edge Functions responden con `{ success, data, error, request_id }`.

---

## 1) Autenticación (Supabase)
- Login: **email/usuario + contraseña**.
- Registro eliminado desde login (usuarios los crea admin).
- Reset de contraseña: flujo estándar de Supabase.

---

## 2) Headers base (Edge Functions)
Se envían **siempre** en todas las Edge Functions:
```
Content-Type: application/json
apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>
Authorization: Bearer <access_token>
Idempotency-Key: <uuid>
x-device-fingerprint: <device_fingerprint>
```
Notas:
- `x-device-fingerprint` se genera y persiste en `localStorage` (`app_device_fingerprint`).
- `Idempotency-Key` se genera por request con `crypto.randomUUID()`.
- En operaciones de turnos/evidencias se agrega **`x-shift-otp-token`**.

---

## 3) OTP en pantalla (sin SMS)
**Objetivo**: facilitar el flujo (usuarios mayores). El OTP se muestra en pantalla.

### 3.1 Enviar OTP
```
POST /functions/v1/phone_otp_send
Headers: (base) + x-device-fingerprint
Body:
{ "device_fingerprint": "<fingerprint>" }
```
Respuesta esperada (OTP visible):
```
{
  "success": true,
  "data": {
    "otp_id": 55,
    "masked_phone": "OTP en pantalla",
    "expires_at": "2026-03-13T07:54:43.755Z",
    "delivery_status": "screen",
    "debug_code": "123456"
  },
  "error": null,
  "request_id": "req_abc123"
}
```
Nota: `masked_phone` puede venir como `"OTP en pantalla"`.

### 3.2 Verificar OTP
```
POST /functions/v1/phone_otp_verify
Headers: (base) + x-device-fingerprint
Body:
{ "code": "123456", "device_fingerprint": "<fingerprint>" }
```
Frontend guarda `verification_token` en `sessionStorage` (`app_shift_otp_token`) y lo envía como `x-shift-otp-token`.

**Importante**:
- `debug_code` se muestra siempre en UI (no SMS).
- `users.phone_e164` **no es obligatorio** con OTP en pantalla.

---

## 4) Dispositivo confiable
### 4.1 Validar dispositivo
```
POST /functions/v1/trusted_device_validate
Body: { "device_fingerprint": "<fingerprint>" }
```
Respuesta esperada:
```
{
  "success": true,
  "data": {
    "trusted": true,
    "registration_required": false,
    "device_id": "dev_123"
  },
  "error": null,
  "request_id": "req_abc123"
}
```

### 4.2 Registrar dispositivo (si aplica)
```
POST /functions/v1/trusted_device_register
Body:
{
  "device_fingerprint": "<fingerprint>",
  "device_name": "Web on <platform>",
  "platform": "web"
}
```
Respuesta esperada:
```
{
  "success": true,
  "data": { "device_id": "dev_123" },
  "error": null,
  "request_id": "req_abc123"
}
```

---

## 5) Dashboard empleado
```
POST /functions/v1/employee_self_service
Body:
{
  "action": "my_dashboard",
  "schedule_limit": 10,
  "pending_tasks_limit": 10
}
```
Devuelve: `scheduled_shifts`, `active_shift`, `pending_tasks_preview`, etc.

---

## 6) Flujo de turnos (Empleado)

### 6.1 Iniciar turno
**Reglas UI previas**:
- GPS listo.
- OTP validado.
- Certificado de aptitud completo.
- **Al menos 1 foto de ingreso**.
- **Cada foto con área + subárea**.

**Contrato**:
```
POST /functions/v1/shifts_start
Headers: (base) + x-device-fingerprint + x-shift-otp-token
Body:
{
  "restaurant_id": 5,
  "lat": 4.7110,
  "lng": -74.0721,
  "fit_for_work": true,
  "declaration": "Me siento bien",
  "scheduled_shift_id": 123 // opcional si hay varios turnos
}
```
Respuesta esperada:
```
{
  "success": true,
  "data": {
    "shift_id": 123,
    "pending_tasks_count": 2
  },
  "error": null,
  "request_id": "req_abc123"
}
```
Notas:
- **Ya no existe ventana de 30 min**. Puede iniciar cualquier turno programado **no vencido**.
- Si hay varios turnos pendientes, enviar `scheduled_shift_id`.

### 6.2 Evidencia de ingreso (por cada foto)
**Request upload**
```
POST /functions/v1/evidence_upload
Headers: (base) + x-device-fingerprint + x-shift-otp-token
Body: { "action": "request_upload", "shift_id": 123, "type": "inicio" }
```
**Respuesta request_upload**:
```
{
  "success": true,
  "data": {
    "upload": {
      "path": "users/<employee_id>/shift-photos/...",
      "signedUrl": "https://...signed...",
      "method": "PUT",
      "headers": { "Content-Type": "image/jpeg" }
    }
  },
  "error": null,
  "request_id": "req_abc123"
}
```
**Upload binario**: `PUT` a `data.upload.signedUrl`.

**Finalize** (por cada foto):
```
POST /functions/v1/evidence_upload
Headers: (base) + x-device-fingerprint + x-shift-otp-token
Body:
{
  "action": "finalize_upload",
  "shift_id": 123,
  "type": "inicio",
  "path": "<path>",
  "lat": 4.7110,
  "lng": -74.0721,
  "accuracy": 8,
  "captured_at": "2026-03-17T12:00:00.000Z",
  "meta": {
    "area_key": "cocina",
    "area_label": "Cocina",
    "subarea_key": "campana",
    "subarea_label": "Campana",
    "area_detail": "opcional si area = otro"
  }
}
```
**Respuesta finalize_upload**:
```
{
  "success": true,
  "data": {
    "evidence_id": 888,
    "path": "users/<employee_id>/shift-photos/...",
    "type": "inicio",
    "meta": { "area_key": "cocina", "subarea_key": "campana" }
  },
  "error": null,
  "request_id": "req_abc123"
}
```
**Soporta múltiples fotos por fase** (inicio y fin). Se repite request_upload + finalize por cada una.

### 6.3 Evidencia de salida (por cada foto)
Mismo flujo de `evidence_upload` con `type: "fin"`.

### 6.4 Finalizar turno
**Validaciones UI previas**:
- Evidencia de inicio existente.
- Evidencia de salida cargada.
- OTP validado.
- Si `now < scheduled_end`: `early_end_reason` obligatorio.

**Contrato**:
```
POST /functions/v1/shifts_end
Headers: (base) + x-device-fingerprint + x-shift-otp-token
Body:
{
  "shift_id": 123,
  "lat": 4.7110,
  "lng": -74.0721,
  "fit_for_work": true,
  "declaration": "Sin incidentes",
  "early_end_reason": "Terminé tareas" // si aplica
}
```
Respuesta esperada:
```
{
  "success": true,
  "data": {},
  "error": null,
  "request_id": "req_abc123"
}
```

---

## 7) Observaciones / Alertas (Empleado)
```
POST /functions/v1/employee_self_service
Body:
{ "action": "create_observation", "shift_id": 123, "kind": "observation|alert", "message": "..." }
```

---

## 8) Incidentes (Supervisora/Admin)
```
POST /functions/v1/incidents_create
Headers: (base) + x-device-fingerprint + x-shift-otp-token
Body:
{ "shift_id": 123, "description": "..." }
```
Requiere OTP + dispositivo confiable.

---

## 9) Tareas operativas (Empleado)
### 9.1 Listar tareas abiertas
```
POST /functions/v1/operational_tasks_manage
Body: { "action": "list_my_open", "limit": 30 }
```
Respuesta esperada:
```
{
  "success": true,
  "data": { "items": [ { "id": 77, "title": "...", "shift_id": 123 } ] },
  "error": null,
  "request_id": "req_abc123"
}
```

### 9.2 Evidencia por imagen
```
POST /functions/v1/operational_tasks_manage
Body: { "action": "request_evidence_upload", "task_id": 77, "mime_type": "image/jpeg" }
```
Respuesta: `data.upload` con `signedUrl` y `path`.
Subir binario → luego:
```
POST /functions/v1/operational_tasks_manage
Body: { "action": "complete", "task_id": 77, "evidence_path": "<path>" }
```

### 9.3 Evidencia manifest (JSON)
```
POST /functions/v1/operational_tasks_manage
Body: { "action": "request_manifest_upload", "task_id": 77 }
```
Respuesta: `data.upload` con `signedUrl` y `path`.
Subir manifest JSON → luego:
```
POST /functions/v1/operational_tasks_manage
Body: { "action": "complete", "task_id": 77, "evidence_path": "<manifest_path>" }
```

Manifest esperado:
```
{
  "version": 1,
  "task_id": 77,
  "captured_at": "2026-03-17T12:00:00.000Z",
  "captured_by": "<user_id>",
  "gps": { "lat": 4.7110, "lng": -74.0721 },
  "evidences": [
    { "shot": "close_up", "path": "...", "evidenceHash": "...", "evidenceMimeType": "...", "evidenceSizeBytes": 12345 },
    { "shot": "mid_range", "path": "...", "evidenceHash": "...", "evidenceMimeType": "...", "evidenceSizeBytes": 12345 },
    { "shot": "wide_general", "path": "...", "evidenceHash": "...", "evidenceMimeType": "...", "evidenceSizeBytes": 12345 }
  ]
}
```

---

## 10) Turnos programados (Supervisora/Admin)
**Listar**
```
POST /functions/v1/scheduled_shifts_manage
Body:
{ "action": "list", "status": "scheduled", "limit": 50 }
```

**Asignar individual**
```
POST /functions/v1/scheduled_shifts_manage
Body:
{
  "action": "assign",
  "employee_id": "<uuid>",
  "restaurant_id": 5,
  "scheduled_start": "2026-03-19T14:00:00.000Z",
  "scheduled_end": "2026-03-19T18:00:00.000Z",
  "notes": "Opcional"
}
```

**Reprogramar**
```
POST /functions/v1/scheduled_shifts_manage
Body:
{
  "action": "reschedule",
  "scheduled_shift_id": 123,
  "scheduled_start": "2026-03-20T14:00:00.000Z",
  "scheduled_end": "2026-03-20T18:00:00.000Z",
  "notes": "Opcional"
}
```

**Cancelar**
```
POST /functions/v1/scheduled_shifts_manage
Body:
{ "action": "cancel", "scheduled_shift_id": 123, "reason": "Opcional" }
```

**Programación masiva (bulk)**
```
POST /functions/v1/scheduled_shifts_manage
Body:
{
  "action": "bulk_assign",
  "entries": [
    {
      "employee_id": "<uuid>",
      "restaurant_id": 5,
      "scheduled_start": "2026-03-19T14:00:00.000Z",
      "scheduled_end": "2026-03-19T18:00:00.000Z",
      "notes": "Opcional"
    }
  ]
}
```
Respuesta esperada:
```
{
  "success": true,
  "data": { "created_ids": [123, 124], "errors": [] },
  "error": null,
  "request_id": "req_abc123"
}
```

---

## 11) Aprobación/Rechazo de turnos (Supervisora/Admin)
```
POST /functions/v1/shifts_approve
Headers: (base) + x-device-fingerprint + x-shift-otp-token
Body: { "shift_id": 123 }
```
```
POST /functions/v1/shifts_reject
Headers: (base) + x-device-fingerprint + x-shift-otp-token
Body: { "shift_id": 123 }
```

---

## 12) Legal consent (compliance)
```
POST /functions/v1/legal_consent
Headers: (base)
Body: { "action": "status" | "accept", ... }
```
(Se usa para validar aceptación de términos antes de operar turnos).

---

## 13) Health check
```
GET /functions/v1/health_ping
```

---

## 14) Logs y trazabilidad
- El frontend loguea en consola (si debug activo):
  - `edge.request <endpoint>` con headers/body redactados
  - `edge.error <endpoint>` con status y mensaje
- Si backend retorna `request_id`, se expone en consola para soporte.

---

## 15) Tabla rápida de endpoints

| Endpoint | Método | Headers | Body (resumen) |
|---|---|---|---|
| `/phone_otp_send` | POST | Base + `x-device-fingerprint` | `{ device_fingerprint }` |
| `/phone_otp_verify` | POST | Base + `x-device-fingerprint` | `{ code, device_fingerprint }` |
| `/trusted_device_validate` | POST | Base + `x-device-fingerprint` | `{ device_fingerprint }` |
| `/trusted_device_register` | POST | Base + `x-device-fingerprint` | `{ device_fingerprint, device_name, platform }` |
| `/employee_self_service` | POST | Base | `{ action: "my_dashboard" }` |
| `/employee_self_service` | POST | Base | `{ action: "create_observation", shift_id, kind, message }` |
| `/shifts_start` | POST | Base + `x-device-fingerprint` + `x-shift-otp-token` | `{ restaurant_id, lat, lng, fit_for_work, declaration, scheduled_shift_id? }` |
| `/evidence_upload` | POST | Base + `x-device-fingerprint` + `x-shift-otp-token` | `{ action: "request_upload", shift_id, type }` |
| `/evidence_upload` | POST | Base + `x-device-fingerprint` + `x-shift-otp-token` | `{ action: "finalize_upload", shift_id, type, path, lat, lng, accuracy, captured_at, meta }` |
| `/shifts_end` | POST | Base + `x-device-fingerprint` + `x-shift-otp-token` | `{ shift_id, lat, lng, fit_for_work, declaration, early_end_reason? }` |
| `/operational_tasks_manage` | POST | Base | `{ action: "list_my_open", limit }` |
| `/operational_tasks_manage` | POST | Base | `{ action: "request_evidence_upload", task_id, mime_type }` |
| `/operational_tasks_manage` | POST | Base | `{ action: "request_manifest_upload", task_id }` |
| `/operational_tasks_manage` | POST | Base | `{ action: "complete", task_id, evidence_path }` |
| `/scheduled_shifts_manage` | POST | Base | `{ action: "assign"|"list"|"reschedule"|"cancel"|"bulk_assign", ... }` |
| `/shifts_approve` | POST | Base + `x-device-fingerprint` + `x-shift-otp-token` | `{ shift_id }` |
| `/shifts_reject` | POST | Base + `x-device-fingerprint` + `x-shift-otp-token` | `{ shift_id }` |
| `/incidents_create` | POST | Base + `x-device-fingerprint` + `x-shift-otp-token` | `{ shift_id, description }` |
| `/legal_consent` | POST | Base | `{ action, ... }` |
| `/health_ping` | GET | — | — |

---

## 16) Respuestas esperadas (éxito) y formato de error
**Envelope estándar (todas las Edge Functions)**
```
{
  "success": true|false,
  "data": { ... } | null,
  "error": { "message": "...", "code": "..." } | null,
  "request_id": "req_abc123"
}
```
Notas:
- `request_id` se debe retornar cuando esté disponible para soporte.

**Formato de error estándar (referencia)**
```
{
  "success": false,
  "data": null,
  "error": { "message": "Human readable message", "code": "SOME_ERROR_CODE" },
  "request_id": "req_abc123"
}
```

### 16.1 OTP
**phone_otp_send (éxito)**
```
{
  "success": true,
  "data": {
    "otp_id": 55,
    "masked_phone": "OTP en pantalla",
    "expires_at": "2026-03-13T07:54:43.755Z",
    "delivery_status": "screen",
    "debug_code": "123456"
  },
  "error": null,
  "request_id": "req_abc123"
}
```

**phone_otp_verify (éxito)**
```
{
  "success": true,
  "data": {
    "verification_token": "shift_otp_token_xyz",
    "expires_at": "2026-03-13T08:04:43.755Z"
  },
  "error": null,
  "request_id": "req_abc123"
}
```

### 16.2 Dispositivo confiable
**trusted_device_validate (éxito)**
```
{
  "success": true,
  "data": { "trusted": true, "registration_required": false, "device_id": "dev_123" },
  "error": null,
  "request_id": "req_abc123"
}
```

**trusted_device_register (éxito)**
```
{
  "success": true,
  "data": { "device_id": "dev_123" },
  "error": null,
  "request_id": "req_abc123"
}
```

### 16.3 Dashboard empleado
```
{
  "success": true,
  "data": {
    "scheduled_shifts": [ { "id": 123, "restaurant_id": 5, "scheduled_start": "...", "scheduled_end": "..." } ],
    "active_shift": null,
    "pending_tasks_preview": [ { "id": 77, "title": "..." } ],
    "history_preview": [ { "id": 999, "status": "ended" } ]
  },
  "error": null,
  "request_id": "req_abc123"
}
```

### 16.4 Turnos
**shifts_start (éxito)**
```
{
  "success": true,
  "data": { "shift_id": 123, "pending_tasks_count": 2 },
  "error": null,
  "request_id": "req_abc123"
}
```

**shifts_end (éxito)**
```
{
  "success": true,
  "data": {},
  "error": null,
  "request_id": "req_abc123"
}
```

### 16.5 Evidencias
**evidence_upload request_upload (éxito)**
```
{
  "success": true,
  "data": {
    "upload": {
      "path": "users/<employee_id>/shift-photos/...",
      "signedUrl": "https://...signed...",
      "method": "PUT",
      "headers": { "Content-Type": "image/jpeg" }
    }
  },
  "error": null,
  "request_id": "req_abc123"
}
```

**evidence_upload finalize_upload (éxito)**
```
{
  "success": true,
  "data": {
    "evidence_id": 888,
    "path": "users/<employee_id>/shift-photos/...",
    "type": "inicio",
    "meta": { "area_key": "cocina", "subarea_key": "campana" }
  },
  "error": null,
  "request_id": "req_abc123"
}
```

### 16.6 Tareas operativas
**list_my_open (éxito)**
```
{
  "success": true,
  "data": { "items": [ { "id": 77, "title": "...", "shift_id": 123 } ] },
  "error": null,
  "request_id": "req_abc123"
}
```
**request_evidence_upload / request_manifest_upload (éxito)**
```
{
  "success": true,
  "data": { "upload": { "path": "...", "signedUrl": "https://...signed...", "method": "PUT" } },
  "error": null,
  "request_id": "req_abc123"
}
```
**complete (éxito)**
```
{
  "success": true,
  "data": { "status": "completed", "task_id": 77 },
  "error": null,
  "request_id": "req_abc123"
}
```

### 16.7 Turnos programados
**assign / reschedule / cancel (éxito)**
```
{
  "success": true,
  "data": { "status": "ok", "scheduled_shift_id": 123 },
  "error": null,
  "request_id": "req_abc123"
}
```
**bulk_assign (éxito)**
```
{
  "success": true,
  "data": { "created_ids": [123, 124], "errors": [] },
  "error": null,
  "request_id": "req_abc123"
}
```

### 16.8 Aprobaciones e incidentes
**shifts_approve / shifts_reject (éxito)**
```
{
  "success": true,
  "data": { "status": "approved", "shift_id": 123 },
  "error": null,
  "request_id": "req_abc123"
}
```
```
{
  "success": true,
  "data": { "status": "rejected", "shift_id": 123 },
  "error": null,
  "request_id": "req_abc123"
}
```
**incidents_create (éxito)**
```
{
  "success": true,
  "data": { "incident_id": 900, "created_at": "2026-03-19T17:00:00.000Z" },
  "error": null,
  "request_id": "req_abc123"
}
```

---

## 17) Ejemplos reales de Network (headers + body)
### 17.1 Headers base (ejemplo)
```
POST /functions/v1/<endpoint>
Content-Type: application/json
apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>
Authorization: Bearer <access_token>
Idempotency-Key: 9e8b9c2a-7f8c-4e2a-b7dd-12d0c4b9f111
x-device-fingerprint: 6f7b7c3a-2c8d-4d15-aab1-8d88c82b9c11
```

### 17.2 Headers con OTP (turnos/evidencias)
```
POST /functions/v1/shifts_start
Content-Type: application/json
apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>
Authorization: Bearer <access_token>
Idempotency-Key: 1a2b3c4d-5e6f-7a8b-9c10-11d12e13f141
x-device-fingerprint: 6f7b7c3a-2c8d-4d15-aab1-8d88c82b9c11
x-shift-otp-token: <verification_token>
```

### 17.3 Iniciar turno (request completo)
```
POST /functions/v1/shifts_start
Headers: (base) + x-device-fingerprint + x-shift-otp-token
Body:
{
  "restaurant_id": 5,
  "lat": 4.7110,
  "lng": -74.0721,
  "fit_for_work": true,
  "declaration": "Me siento bien",
  "scheduled_shift_id": 123
}
```

### 17.4 Evidencia (request_upload + finalize_upload)
```
POST /functions/v1/evidence_upload
Body: { "action": "request_upload", "shift_id": 123, "type": "inicio" }
```
```
POST /functions/v1/evidence_upload
Body:
{
  "action": "finalize_upload",
  "shift_id": 123,
  "type": "inicio",
  "path": "users/<employee_id>/shift-photos/...",
  "lat": 4.7110,
  "lng": -74.0721,
  "accuracy": 8,
  "captured_at": "2026-03-17T12:00:00.000Z",
  "meta": {
    "area_key": "cocina",
    "area_label": "Cocina",
    "subarea_key": "campana",
    "subarea_label": "Campana"
  }
}
```

### 17.5 Programación masiva (bulk_assign)
```
POST /functions/v1/scheduled_shifts_manage
Body:
{
  "action": "bulk_assign",
  "entries": [
    {
      "employee_id": "<uuid>",
      "restaurant_id": 5,
      "scheduled_start": "2026-03-19T14:00:00.000Z",
      "scheduled_end": "2026-03-19T18:00:00.000Z",
      "notes": "Opcional"
    }
  ]
}
```

---

## 18) Errores típicos y manejo en UI
- `OTP_INVALID` / `OTP_EXPIRED`: pedir revalidación de OTP.
- `DEVICE_NOT_TRUSTED`: mostrar flujo de registro de dispositivo.
- `SHIFT_NOT_FOUND` / `SHIFT_ALREADY_ENDED`: refrescar dashboard y notificar al usuario.
- `MISSING_EVIDENCE` / `MISSING_META`: bloquear avance hasta completar foto + área + subárea.
- `UPLOAD_FAILED`: reintentar finalize_upload (respetando idempotencia).

---

Si necesitas añadir respuestas exactas del backend o ejemplos reales de Network, indícalo y los anexamos.

# Frontend - Cambios Empleado (para backend)

Fecha: 2026-03-17

Este documento resume los cambios implementados en el frontend para el **rol empleado** y las
reglas/expectativas necesarias desde backend.

## 1) Inicio de app (limpieza de UI)
- Se elimina **"Auto por rol"** (genera ruido).
- Se elimina texto de **"Construir la política de datos"** en home.
- Pantalla inicial queda más minimal: solo selector de idioma (ES/EN) y acceso a login.
- **Insumos desactivado temporalmente** (UI y navegación ocultas).

## 2) Perfil de empleado - pantallas y flujo

### Pantalla 1: Login
Usuario ingresa:
- correo o usuario
- contraseña
- botón **Ingresar**
- **Olvidaste contraseña**

Notas de contraseña:
- Se elimina el registro de usuarios desde el login (usuarios los crea admin).
- El login sigue siendo **email/usuario + contraseña**.
- Se evalúa **PIN numérico (6 dígitos)** para abrir teclado numérico en móvil.
  - Si backend quiere PIN, deben definir política y validación.

### Pantalla 2: Hub (Inicio o Perfil)
Usuario ve:
- Saludo (“Hola, Nombre”)
- 3 acciones:
  - **Iniciar turno**
  - **Ver perfil**
  - **Cerrar sesión**

### Pantalla 3: Iniciar turno / Ver perfil
**Nota UI**: Pantalla 3 y 4 se muestran **unidas** en una sola vista (info + evidencia antes de registrar inicio).

**Iniciar turno**
Usuario ve:
- Nombre, fecha, hora inicio/fin, restaurante
- Tareas especiales (asignadas por supervisora al crear turno)
- Requisitos: GPS, Cámara, Certificado de aptitud
- Botón **Iniciar turno**

**Ver perfil**
Usuario ve:
- Turnos programados
- Tareas especiales pendientes
- Historial de turnos
Acciones:
- **Iniciar turno**
- **Cerrar sesión**

### Pantalla 4: Evidencia de ingreso + flujo de limpieza
Usuario:
- Toma **foto(s) de ingreso**
- Debe **etiquetar área y subárea** por foto (dropdowns)
- Clic **Registrar inicio**
- Pasa a pantalla “Limpiando”
- Luego vuelve para **foto(s) de salida** (también con área/subárea)
- Observaciones de tarea especial
- Botón **Finalizar turno**

Sistema responde:
- “Almacenando datos…”

### Pantalla 5: Limpiando
Usuario:
- Ve pantalla de “Limpiando” con nombre del restaurante
- Aviso de no cerrar la app
- Botón grande **“TERMINÉ DE LIMPIAR”**

### Pantalla 6: Finalizar
Usuario:
- Foto(s) de salida con área/subárea
- Observaciones de tarea
- Resumen del turno (sin duración)
- Botón **Finalizar turno**

### Pantalla 7: Éxito
UI:
- Fondo verde celebratorio
- Check grande en círculo blanco
- Detalles del turno
- Barra animada “Guardando datos…”
- Botones: **Ver mis turnos** / **Volver al inicio**

## 3) Evidencias por área y subárea (requerido)
El frontend ahora exige **etiquetar cada foto** con:
- `area` (ej: Cocina, Baños, Comedor)
- `subarea` (ej: Campana, Pisos, Esquinas, etc)

Se envía en el `meta` de la evidencia.
Backend acepta y guarda:
```
meta: {
  area_key: "cocina",
  area_label: "Cocina",
  subarea_key: "campana",
  subarea_label: "Campana",
  area_detail?: "texto libre si area = otro"
}
```
**Estado actual**: el frontend **ya envía** este `meta` en `finalize_upload` para cada foto.

**Backend confirmado**:
- Se permiten **múltiples fotos por fase** (inicio y fin) para el mismo turno.
- Se hace `request_upload` + `finalize_upload` **por cada foto**.

## 4) Catálogo de áreas / subáreas

**Cocina**
- Campana
- Pisos
- Esquinas
- Detrás de freidoras
- Debajo de mesas
- Frente de neveras

**Comedor**
- General
- Pisos
- Esquinas
- Debajo de mesas y asientos
- Marcos de ventanas

**Puntos de dispensadores de gaseosas**
- Frente
- Atrás
- Gabinetes

**Desagües**

**Fachadas / Patios**
- Pisos
- Esquinas
- Debajo de mesas y asientos
- Marcos de ventanas

**Baños**
- Pisos
- Sanitarios adelante
- Sanitarios atrás
- Lavamanos
- Cambiador de niños
- Puertas y marcos

## 5) Reglas de turnos (backend)
Pre-requisitos antes de iniciar turno:
- Legal consent aceptado
- Dispositivo confiable (trusted device)
- OTP validado (x-shift-otp-token)

Regla ventana de inicio:
- Solo inicia si hay turno programado con:
  - `scheduled_start <= now + 30 min`
  - `scheduled_end >= now`

Evidencias:
- Foto **inicio** obligatoria (type: `inicio`)
- Foto **fin** obligatoria (type: `fin`)

Finalizar turno:
- Si se termina antes de `scheduled_end`, `early_end_reason` es obligatoria

## 6) OTP en pantalla (sin SMS)
Para simplificar el flujo (usuarios mayores), el OTP **se muestra en pantalla** sin envío SMS.

Backend confirmado:
- `phone_otp_send` debe devolver `debug_code` siempre (no solo demo).
- `delivery_status` puede venir como `"debug"` o `"screen"`.
- El frontend **muestra el `debug_code` en UI** para que el usuario lo ingrese manualmente.

**Source of truth del teléfono**
- Si el OTP es en pantalla, `users.phone_e164` **no es obligatorio**.
- Si en el futuro se vuelve a SMS, se re‑habilita `phone_e164` como requerido.

## 7) Contraseñas / manejo de acceso
Resumen:
- Login: **email/usuario + contraseña**
- **Registro eliminado** desde login (admin crea usuarios)
- Reset de contraseña se mantiene con flujo de Supabase
- Posible **PIN de 6 dígitos** (pendiente decisión backend)

Si backend define PIN:
- Acordar validación y longitud
- Definir endpoint/estrategia (ej: mismo password, o pin separado)

---

Si necesitan una versión con checklist técnico o contratos API exactos, se puede extender este archivo.

## 8) Contratos API reales (desde UI)

### 8.1 Headers base (Edge Functions)
Todos los Edge Functions usan `POST` (excepto `GET /health_ping`).
Headers que el frontend envía siempre:
```
Content-Type: application/json
apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>
Authorization: Bearer <access_token>
Idempotency-Key: <uuid>
x-device-fingerprint: <device_fingerprint>
```
Notas:
- `x-device-fingerprint` se genera y guarda en `localStorage` (`app_device_fingerprint`).
- `Idempotency-Key` se genera por request con `crypto.randomUUID()`.
- Para operaciones de turno/evidencia se agrega `x-shift-otp-token`.

### 8.2 OTP (en pantalla, sin SMS)

**Enviar OTP**
```
POST /functions/v1/phone_otp_send
Headers: (base) + x-device-fingerprint
Body:
{ "device_fingerprint": "<fingerprint>" }
```
Respuesta usada por UI (OTP visible):
```
{
  "otp_id": 55,
  "masked_phone": "+57***169",
  "expires_at": "2026-03-13T07:54:43.755Z",
  "delivery_status": "debug",
  "debug_code": "123456"
}
```

**Verificar OTP**
```
POST /functions/v1/phone_otp_verify
Headers: (base) + x-device-fingerprint
Body:
{ "code": "123456", "device_fingerprint": "<fingerprint>" }
```
La UI guarda el `verification_token` en `sessionStorage` (`app_shift_otp_token`) y lo envía en `x-shift-otp-token`.

**¿Dónde se guarda el debug_code?**
- Solo en memoria (state), **no** se guarda en localStorage.
- Se muestra siempre en pantalla para este flujo (OTP visible).

### 8.3 Dispositivo confiable
**Validar dispositivo**
```
POST /functions/v1/trusted_device_validate
Body: { "device_fingerprint": "<fingerprint>" }
```
**Registrar dispositivo (si required)**
```
POST /functions/v1/trusted_device_register
Body: {
  "device_fingerprint": "<fingerprint>",
  "device_name": "Web on <platform>",
  "platform": "web"
}
```

### 8.4 Dashboard empleado
```
POST /functions/v1/employee_self_service
Body:
{
  "action": "my_dashboard",
  "schedule_limit": 10,
  "pending_tasks_limit": 10
}
```

### 8.5 Turnos programados (listado)
**Empleado**
- Se obtienen desde `employee_self_service` → `action: "my_dashboard"`.
- La UI muestra lo que viene en `scheduled_shifts` y marca estado local (scheduled / in_progress / ended).

**Supervisora/Admin**
- Sí usa `scheduled_shifts_manage` (fuera del scope de este documento).

### 8.6 Iniciar turno
**Validaciones UI previas**
- GPS listo.
- OTP validado.
- Checklist de salud completo.
- Al menos 1 foto de ingreso.
- Cada foto tiene área + subárea seleccionadas.
- Debe existir turno programado en ventana (30 min antes → fin).

**Request**
```
POST /functions/v1/shifts_start
Headers: (base) + x-device-fingerprint + x-shift-otp-token
Body:
{
  "restaurant_id": 5,
  "lat": 4.7110,
  "lng": -74.0721,
  "fit_for_work": true,
  "declaration": "Me siento bien"
}
```

### 8.7 Evidencia de inicio (por cada foto capturada)
**Request upload**
```
POST /functions/v1/evidence_upload
Headers: (base) + x-device-fingerprint + x-shift-otp-token
Body:
{ "action": "request_upload", "shift_id": 123, "type": "inicio" }
```
**Upload binario**
- Se sube con `PUT` al `signedUrl` (o signed token si aplica).

**Finalize**
```
POST /functions/v1/evidence_upload
Headers: (base) + x-device-fingerprint + x-shift-otp-token
Body:
{
  "action": "finalize_upload",
  "shift_id": 123,
  "type": "inicio",
  "path": "<path devuelto>",
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
**Importante**: se envía `meta` por cada foto (inicio y fin).

### 8.8 Evidencia de salida (por cada foto)
Mismo flujo que inicio, con `type: "fin"`.
Se repite `request_upload` + `finalize_upload` **por cada foto**.

### 8.9 Finalizar turno
**Validaciones UI previas**
- Evidencia de inicio existente.
- OTP validado.
- Checklist de salida completo.
- Evidencia de salida cargada.
- Si `now < scheduled_end`: `early_end_reason` obligatorio.

**Request**
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

### 8.10 Tareas del turno (empleado)
**Listar tareas abiertas**
```
POST /functions/v1/operational_tasks_manage
Body:
{ "action": "list_my_open", "limit": 30 }
```
La UI filtra por `shift_id` del turno activo para mostrar **solo tareas del turno**.

**Completar tarea (evidencia por imagen)**
```
POST /functions/v1/operational_tasks_manage
Body:
{ "action": "request_evidence_upload", "task_id": 77, "mime_type": "image/jpeg" }
```
Subir binario al `signedUrl` → `complete`:
```
POST /functions/v1/operational_tasks_manage
Body:
{ "action": "complete", "task_id": 77, "evidence_path": "<path>" }
```

**Completar tarea (manifest JSON)**
```
POST /functions/v1/operational_tasks_manage
Body:
{ "action": "request_manifest_upload", "task_id": 77 }
```
El frontend sube un JSON con:
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
Luego se finaliza con:
```
POST /functions/v1/operational_tasks_manage
Body:
{ "action": "complete", "task_id": 77, "evidence_path": "<manifest_path>" }
```

### 8.11 Observaciones (empleado)
```
POST /functions/v1/employee_self_service
Body:
{ "action": "create_observation", "shift_id": 123, "kind": "observation|alert", "message": "..." }
```

### 8.12 Logs / errores
El frontend loguea en consola (si debug está activo):
- `edge.request <endpoint>` con headers y body redactados
- `edge.error <endpoint>` con status y mensaje
- Incluye `request_id` cuando backend lo retorna

## 9) Tabla resumen (endpoint | headers | body | ejemplo real)

**Headers base en todos los requests**
`Content-Type, apikey, Authorization, Idempotency-Key, x-device-fingerprint`  
Para turnos/evidencias además: `x-shift-otp-token`.

| Endpoint | Método | Headers | Body (resumen) | Ejemplo real |
|---|---|---|---|---|
| `/trusted_device_validate` | POST | Base + `x-device-fingerprint` | `{ device_fingerprint }` | `{ "device_fingerprint": "<fingerprint>" }` |
| `/trusted_device_register` | POST | Base + `x-device-fingerprint` | `{ device_fingerprint, device_name, platform }` | `{ "device_fingerprint": "<fingerprint>", "device_name": "Web on Win32", "platform": "web" }` |
| `/phone_otp_send` | POST | Base + `x-device-fingerprint` | `{ device_fingerprint }` | `{ "device_fingerprint": "<fingerprint>" }` |
| `/phone_otp_verify` | POST | Base + `x-device-fingerprint` | `{ code, device_fingerprint }` | `{ "code": "123456", "device_fingerprint": "<fingerprint>" }` |
| `/employee_self_service` | POST | Base | `{ action: "my_dashboard", schedule_limit, pending_tasks_limit }` | `{ "action": "my_dashboard", "schedule_limit": 10, "pending_tasks_limit": 10 }` |
| `/employee_self_service` | POST | Base | `{ action: "create_observation", shift_id, kind, message }` | `{ "action": "create_observation", "shift_id": 123, "kind": "observation", "message": "..." }` |
| `/shifts_start` | POST | Base + `x-device-fingerprint` + `x-shift-otp-token` | `{ restaurant_id, lat, lng, fit_for_work, declaration }` | `{ "restaurant_id": 5, "lat": 4.7110, "lng": -74.0721, "fit_for_work": true, "declaration": "Me siento bien" }` |
| `/evidence_upload` | POST | Base + `x-device-fingerprint` + `x-shift-otp-token` | `{ action: "request_upload", shift_id, type }` | `{ "action": "request_upload", "shift_id": 123, "type": "inicio" }` |
| `/evidence_upload` | POST | Base + `x-device-fingerprint` + `x-shift-otp-token` | `{ action: "finalize_upload", shift_id, type, path, lat, lng, accuracy, captured_at, meta }` | `{ "action": "finalize_upload", "shift_id": 123, "type": "inicio", "path": "...", "lat": 4.7110, "lng": -74.0721, "accuracy": 8, "captured_at": "2026-03-17T12:00:00.000Z", "meta": { "area_key": "cocina", "area_label": "Cocina", "subarea_key": "campana", "subarea_label": "Campana" } }` |
| `/shifts_end` | POST | Base + `x-device-fingerprint` + `x-shift-otp-token` | `{ shift_id, lat, lng, fit_for_work, declaration, early_end_reason? }` | `{ "shift_id": 123, "lat": 4.7110, "lng": -74.0721, "fit_for_work": true, "declaration": "Sin incidentes", "early_end_reason": "Terminé tareas" }` |
| `/operational_tasks_manage` | POST | Base | `{ action: "list_my_open", limit }` | `{ "action": "list_my_open", "limit": 30 }` |
| `/operational_tasks_manage` | POST | Base | `{ action: "request_evidence_upload", task_id, mime_type }` | `{ "action": "request_evidence_upload", "task_id": 77, "mime_type": "image/jpeg" }` |
| `/operational_tasks_manage` | POST | Base | `{ action: "request_manifest_upload", task_id }` | `{ "action": "request_manifest_upload", "task_id": 77 }` |
| `/operational_tasks_manage` | POST | Base | `{ action: "complete", task_id, evidence_path }` | `{ "action": "complete", "task_id": 77, "evidence_path": "users/<employee_id>/task-evidence/..." }` |

## 10) Perfil de supervisión (lineamientos de UI)
Pendiente de implementación visual, mantener **pantallas simples** y por función:
- Dashboard simplificado (sin header/sidebars) con botones grandes.
- Cada módulo abre pantalla con botón **Volver al inicio**.
- Gestión restaurante
- Gestión usuarios
- Gestión de turnos
- Gestión de supervisión (evidencias ingreso/limpieza/salida + observaciones + finalizar)
- Gestión de insumos (desactivado por ahora)
- Gestión de alertas
- Gestión de informes

## 11) Perfil de superusuario
Gestionar (mismo enfoque simple y sin sobrecargar).
- Dashboard simplificado con accesos directos (restaurantes, usuarios, reportes, turnos).

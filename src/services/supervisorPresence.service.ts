import { invokeEdge } from "@/services/edgeClient"

type PresencePhase = "start" | "end"

export interface SupervisorPresenceLog {
  id: number
  supervisor_id: string
  restaurant_id: number
  phase: PresencePhase
  lat: number
  lng: number
  evidence_path: string
  evidence_hash: string
  evidence_mime_type: string
  evidence_size_bytes: number
  recorded_at: string
  notes: string | null
}

export interface SupervisorPresenceSummary {
  id: string
  supervisor_id: string | null
  supervisor_name?: string | null
  restaurant_id: number | null
  restaurant_name?: string | null
  phase: PresencePhase
  recorded_at: string
  notes?: string | null
}

interface RegisterSupervisorPresencePayload {
  restaurantId: number
  phase: PresencePhase
  lat: number
  lng: number
  notes?: string | null
  evidencePath: string
  evidenceHash: string
  evidenceMimeType: string
  evidenceSizeBytes: number
}

export async function registerSupervisorPresence(payload: RegisterSupervisorPresencePayload) {
  await invokeEdge("supervisor_presence_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "register",
      restaurant_id: payload.restaurantId,
      phase: payload.phase,
      lat: payload.lat,
      lng: payload.lng,
      notes: payload.notes ?? null,
      evidence_path: payload.evidencePath,
      evidence_hash: payload.evidenceHash,
      evidence_mime_type: payload.evidenceMimeType,
      evidence_size_bytes: payload.evidenceSizeBytes,
    },
  })
}

export async function listMySupervisorPresence(limit = 20) {
  const payload = await invokeEdge<unknown>("supervisor_presence_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list_my",
      limit,
    },
  })

  return unwrapPresenceItems(payload)
}

export async function listSupervisorPresenceByRestaurant(
  restaurantId: number,
  limit = 50,
  range?: { from?: string; to?: string }
) {
  const payload = await invokeEdge<unknown>("supervisor_presence_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list_by_restaurant",
      restaurant_id: restaurantId,
      limit,
      ...(range?.from ? { from: range.from } : {}),
      ...(range?.to ? { to: range.to } : {}),
    },
  })

  return unwrapPresenceItems(payload)
}

export async function listSupervisorPresenceToday(
  limit = 20,
  range?: { from?: string; to?: string }
) {
  const payload = await invokeEdge<unknown>("supervisor_presence_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list_today",
      limit,
      ...(range?.from ? { from: range.from } : {}),
      ...(range?.to ? { to: range.to } : {}),
    },
  })

  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : []

  return items
    .map(raw => normalizePresenceSummary(raw))
    .filter((row): row is SupervisorPresenceSummary => row !== null)
}

function unwrapPresenceItems(payload: unknown) {
  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : []

  return items as SupervisorPresenceLog[]
}

function normalizePresenceSummary(raw: unknown): SupervisorPresenceSummary | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const idRaw = row.id
  const id =
    typeof idRaw === "number"
      ? String(idRaw)
      : typeof idRaw === "string" && idRaw.trim().length > 0
        ? idRaw
        : null
  const recordedAt = typeof row.recorded_at === "string" ? row.recorded_at : null
  const phase = typeof row.phase === "string" ? (row.phase as PresencePhase) : null
  if (!id || !recordedAt || !phase) return null

  const restaurantId =
    typeof row.restaurant_id === "number"
      ? row.restaurant_id
      : typeof row.restaurant_id === "string"
        ? Number(row.restaurant_id)
        : null

  return {
    id,
    supervisor_id: typeof row.supervisor_id === "string" ? row.supervisor_id : row.supervisor_id ? String(row.supervisor_id) : null,
    supervisor_name: typeof row.supervisor_name === "string" ? row.supervisor_name : null,
    restaurant_id: Number.isFinite(restaurantId ?? NaN) ? (restaurantId as number) : null,
    restaurant_name: typeof row.restaurant_name === "string" ? row.restaurant_name : null,
    phase,
    recorded_at: recordedAt,
    notes: typeof row.notes === "string" ? row.notes : null,
  }
}

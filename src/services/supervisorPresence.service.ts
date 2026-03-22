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

export async function listSupervisorPresenceByRestaurant(restaurantId: number, limit = 50) {
  const payload = await invokeEdge<unknown>("supervisor_presence_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list_by_restaurant",
      restaurant_id: restaurantId,
      limit,
    },
  })

  return unwrapPresenceItems(payload)
}

function unwrapPresenceItems(payload: unknown) {
  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : []

  return items as SupervisorPresenceLog[]
}

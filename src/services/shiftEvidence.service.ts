import { invokeEdge } from "@/services/edgeClient"

export type ShiftEvidenceType = "inicio" | "fin"

export interface ShiftEvidenceItem {
  id: string
  shift_id: string
  type: ShiftEvidenceType
  storage_path: string
  captured_at: string | null
  lat: number | null
  lng: number | null
}

function toStringId(value: unknown) {
  if (typeof value === "string" && value.trim().length > 0) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function toNullableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function normalizeEvidenceItem(raw: unknown): ShiftEvidenceItem | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const id = toStringId(row.id)
  const shiftId = toStringId(row.shift_id)
  const type = typeof row.type === "string" ? (row.type as ShiftEvidenceType) : null
  const storagePath = typeof row.storage_path === "string" ? row.storage_path : null
  if (!id || !shiftId || !type || !storagePath) return null

  return {
    id,
    shift_id: shiftId,
    type,
    storage_path: storagePath,
    captured_at: typeof row.captured_at === "string" ? row.captured_at : null,
    lat: toNullableNumber(row.lat),
    lng: toNullableNumber(row.lng),
  }
}

function unwrapItems(payload: unknown) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== "object") return [] as unknown[]
  const wrapped = payload as { items?: unknown }
  return Array.isArray(wrapped.items) ? wrapped.items : []
}

export async function listShiftEvidenceByShift(payload: {
  shiftId: string | number
  type?: ShiftEvidenceType | null
  limit?: number
}) {
  const raw = await invokeEdge<unknown>("shift_evidence_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list_by_shift",
      shift_id: Number(payload.shiftId),
      type: payload.type ?? null,
      limit: payload.limit ?? 50,
    },
  })

  return unwrapItems(raw)
    .map(normalizeEvidenceItem)
    .filter((item): item is ShiftEvidenceItem => item !== null)
}

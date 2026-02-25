import { supabase } from "@/services/supabaseClient"
import { invokeEdge } from "@/services/edgeClient"

export type ShiftStatus = "active" | "completed" | "cancelled" | string

export interface ShiftRecord {
  id: string
  start_time: string
  end_time: string | null
  status: ShiftStatus
}

interface StartShiftPayload {
  restaurantId?: number
  lat: number
  lng: number
  fitForWork: boolean
  declaration: string | null
}

interface EndShiftPayload {
  shiftId: string
  lat: number
  lng: number
  fitForWork: boolean
  declaration: string | null
}

export interface ShiftHistoryResult {
  rows: ShiftRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

function normalizeActiveShift(data: unknown): ShiftRecord | null {
  if (!data) return null

  if (Array.isArray(data)) {
    return (data[0] as ShiftRecord | undefined) ?? null
  }

  return data as ShiftRecord
}

export async function startShift(payload: StartShiftPayload) {
  const { restaurantId, lat, lng, fitForWork, declaration } = payload
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || typeof fitForWork !== "boolean") {
    throw new Error("Datos incompletos para iniciar turno.")
  }

  const data = await invokeEdge<unknown>("shifts_start", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      restaurant_id: restaurantId,
      lat,
      lng,
      fit_for_work: fitForWork,
      declaration,
    },
  })

  if (typeof data === "number") return data
  if (typeof data === "object" && data !== null) {
    const shiftId = (data as { shift_id?: unknown; id?: unknown }).shift_id ?? (data as { id?: unknown }).id
    if (typeof shiftId === "number") return shiftId
    if (typeof shiftId === "string" && shiftId.trim()) return Number(shiftId)
  }
  throw new Error("Respuesta invalida desde shifts_start.")
}

export async function endShift(payload: EndShiftPayload) {
  const { shiftId, lat, lng, fitForWork, declaration } = payload
  if (!shiftId || !Number.isFinite(lat) || !Number.isFinite(lng) || typeof fitForWork !== "boolean") {
    throw new Error("Datos incompletos para finalizar turno.")
  }

  return invokeEdge("shifts_end", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      shift_id: Number(shiftId),
      lat,
      lng,
      fit_for_work: fitForWork,
      declaration,
    },
  })
}

export async function getMyActiveShift() {
  const { data, error } = await supabase.rpc("get_my_active_shift")
  if (error) throw error
  return normalizeActiveShift(data)
}

export async function getMyShiftHistory(page = 1, pageSize = 8): Promise<ShiftHistoryResult> {
  const safePage = Math.max(1, page)
  const safePageSize = Math.max(1, pageSize)
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user?.id) throw new Error("Usuario autenticado no encontrado.")

  const { data, error, count } = await supabase
    .from("shifts")
    .select("id,start_time,end_time,status", { count: "exact" })
    .eq("employee_id", user.id)
    .order("start_time", { ascending: false })
    .range(from, to)

  if (error) throw error

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))

  return {
    rows: (data as ShiftRecord[]) ?? [],
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  }
}

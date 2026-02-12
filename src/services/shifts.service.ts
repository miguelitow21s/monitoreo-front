import { supabase } from "@/services/supabaseClient"

export type ShiftStatus = "active" | "completed" | "cancelled" | string

export interface ShiftRecord {
  id: string
  start_time: string
  end_time: string | null
  status: ShiftStatus
}

interface StartShiftPayload {
  lat: number
  lng: number
  evidencePath: string
}

interface EndShiftPayload {
  shiftId: string
  lat: number
  lng: number
  evidencePath: string
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
  const { lat, lng, evidencePath } = payload
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !evidencePath) {
    throw new Error("Datos incompletos para iniciar turno.")
  }

  const { data, error } = await supabase.rpc("start_shift", payload)
  if (error) throw error
  return data
}

export async function endShift(payload: EndShiftPayload) {
  const { shiftId, lat, lng, evidencePath } = payload
  if (!shiftId || !Number.isFinite(lat) || !Number.isFinite(lng) || !evidencePath) {
    throw new Error("Datos incompletos para finalizar turno.")
  }

  const { data, error } = await supabase.rpc("end_shift", payload)
  if (error) throw error
  return data
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

  const { data, error, count } = await supabase
    .from("shifts")
    .select("id,start_time,end_time,status", { count: "exact" })
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

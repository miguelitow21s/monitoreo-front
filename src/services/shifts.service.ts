// src/services/shifts.service.ts
import { supabase } from "@/services/supabaseClient"

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

export async function startShift(payload: StartShiftPayload) {
  const { data, error } = await supabase.rpc("start_shift", payload)
  if (error) throw error
  return data
}

export async function endShift(payload: EndShiftPayload) {
  const { data, error } = await supabase.rpc("end_shift", payload)
  if (error) throw error
  return data
}

export async function getMyActiveShift() {
  const { data, error } = await supabase.rpc("get_my_active_shift")
  if (error) throw error
  return data
}

export async function getMyShiftHistory() {
  const { data, error } = await supabase
    .from("shifts")
    .select("*")
    .order("start_time", { ascending: false })

  if (error) throw error
  return data
}

import { supabase } from "@/services/supabaseClient"

export interface ScheduledShift {
  id: number
  employee_id: string
  restaurant_id: number
  scheduled_start: string
  scheduled_end: string
  status: string
  notes: string | null
}

export async function assignScheduledShift(payload: {
  employeeId: string
  restaurantId: string
  scheduledStartIso: string
  scheduledEndIso: string
  notes?: string
}) {
  const { employeeId, restaurantId, scheduledStartIso, scheduledEndIso, notes } = payload

  const { data, error } = await supabase.rpc("assign_scheduled_shift", {
    p_employee_id: employeeId,
    p_restaurant_id: Number(restaurantId),
    p_scheduled_start: scheduledStartIso,
    p_scheduled_end: scheduledEndIso,
    p_notes: notes ?? null,
  })

  if (error) throw error
  return data
}

export async function listMyScheduledShifts(limit = 10) {
  const { data, error } = await supabase.rpc("list_my_scheduled_shifts", {
    p_limit: limit,
  })

  if (error) throw error
  return (data ?? []) as ScheduledShift[]
}

export async function listScheduledShifts(limit = 50) {
  const { data, error } = await supabase.rpc("list_scheduled_shifts", {
    p_limit: limit,
  })

  if (error) throw error
  return (data ?? []) as ScheduledShift[]
}

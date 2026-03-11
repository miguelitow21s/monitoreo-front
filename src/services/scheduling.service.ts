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

interface ReprogramScheduledShiftPayload {
  scheduledShiftId: number
  scheduledStartIso: string
  scheduledEndIso: string
  notes?: string
}

function filterUpcomingScheduledShifts(items: ScheduledShift[]) {
  const now = Date.now()
  return items.filter(item => {
    if ((item.status ?? "").toLowerCase() !== "scheduled") return false
    const startsAt = new Date(item.scheduled_start).getTime()
    return Number.isFinite(startsAt) && startsAt > now
  })
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
  const rpcResult = await supabase.rpc("list_my_scheduled_shifts", {
    p_limit: limit,
  })

  if (rpcResult.error) {
    const retryWithoutArgs = await supabase.rpc("list_my_scheduled_shifts")
    if (!retryWithoutArgs.error) {
      return filterUpcomingScheduledShifts((retryWithoutArgs.data ?? []) as ScheduledShift[]).slice(0, limit)
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw rpcResult.error

    const fallback = await supabase
      .from("scheduled_shifts")
      .select("id,employee_id,restaurant_id,scheduled_start,scheduled_end,status,notes")
      .eq("employee_id", user.id)
      .order("scheduled_start", { ascending: true })
      .limit(limit)

    if (fallback.error) throw rpcResult.error
    return filterUpcomingScheduledShifts((fallback.data ?? []) as ScheduledShift[])
  }

  return filterUpcomingScheduledShifts((rpcResult.data ?? []) as ScheduledShift[]).slice(0, limit)
}

export async function listScheduledShifts(limit = 50) {
  const rpcResult = await supabase.rpc("list_scheduled_shifts", {
    p_limit: limit,
  })

  if (rpcResult.error) {
    const retryWithoutArgs = await supabase.rpc("list_scheduled_shifts")
    if (!retryWithoutArgs.error) {
      return filterUpcomingScheduledShifts((retryWithoutArgs.data ?? []) as ScheduledShift[]).slice(0, limit)
    }

    const fallback = await supabase
      .from("scheduled_shifts")
      .select("id,employee_id,restaurant_id,scheduled_start,scheduled_end,status,notes")
      .order("scheduled_start", { ascending: true })
      .limit(limit)

    if (fallback.error) throw rpcResult.error
    return filterUpcomingScheduledShifts((fallback.data ?? []) as ScheduledShift[])
  }

  return filterUpcomingScheduledShifts((rpcResult.data ?? []) as ScheduledShift[]).slice(0, limit)
}

export async function cancelScheduledShift(scheduledShiftId: number, notes?: string) {
  const { data, error } = await supabase
    .from("scheduled_shifts")
    .update({
      status: "cancelled",
      notes: notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduledShiftId)
    .select("*")
    .single()

  if (error) throw error
  return data as ScheduledShift
}

export async function reprogramScheduledShift(payload: ReprogramScheduledShiftPayload) {
  const { scheduledShiftId, scheduledStartIso, scheduledEndIso, notes } = payload

  const { data, error } = await supabase
    .from("scheduled_shifts")
    .update({
      scheduled_start: scheduledStartIso,
      scheduled_end: scheduledEndIso,
      status: "scheduled",
      notes: notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduledShiftId)
    .select("*")
    .single()

  if (error) throw error
  return data as ScheduledShift
}

export async function assignScheduledShiftsBulk(payload: {
  employeeId: string
  restaurantId: string
  blocks: Array<{ scheduledStartIso: string; scheduledEndIso: string }>
  notes?: string
}) {
  const blocks = payload.blocks.filter(item => item.scheduledStartIso && item.scheduledEndIso)
  if (blocks.length === 0) return [] as unknown[]

  const results = await Promise.all(
    blocks.map(block =>
      assignScheduledShift({
        employeeId: payload.employeeId,
        restaurantId: payload.restaurantId,
        scheduledStartIso: block.scheduledStartIso,
        scheduledEndIso: block.scheduledEndIso,
        notes: payload.notes,
      })
    )
  )

  return results
}

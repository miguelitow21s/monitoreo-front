import { invokeEdge } from "@/services/edgeClient"

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

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : null
}

function normalizeScheduledShift(raw: unknown): ScheduledShift | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>

  const id = toNumber(row.id)
  const employeeId = toStringValue(row.employee_id)
  const restaurantId = toNumber(row.restaurant_id)
  const scheduledStart = toStringValue(row.scheduled_start)
  const scheduledEnd = toStringValue(row.scheduled_end)

  if (
    id === null ||
    !employeeId ||
    restaurantId === null ||
    !scheduledStart ||
    !scheduledEnd
  ) {
    return null
  }

  return {
    id,
    employee_id: employeeId,
    restaurant_id: restaurantId,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    status: toStringValue(row.status) ?? "scheduled",
    notes: toStringValue(row.notes),
  }
}

function normalizeScheduledItems(payload: unknown) {
  const direct = Array.isArray(payload) ? payload : []
  if (direct.length > 0) {
    return direct.map(normalizeScheduledShift).filter((item): item is ScheduledShift => item !== null)
  }

  if (!payload || typeof payload !== "object") return [] as ScheduledShift[]
  const wrapped = payload as { items?: unknown }
  const items = Array.isArray(wrapped.items) ? wrapped.items : []
  return items.map(normalizeScheduledShift).filter((item): item is ScheduledShift => item !== null)
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

  return invokeEdge("scheduled_shifts_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "assign",
      employee_id: employeeId,
      restaurant_id: Number(restaurantId),
      scheduled_start: scheduledStartIso,
      scheduled_end: scheduledEndIso,
      notes: notes ?? null,
    },
  })
}

export async function listMyScheduledShifts(limit = 10) {
  const data = await invokeEdge<unknown>("scheduled_shifts_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list",
      status: "scheduled",
      limit,
    },
  })
  return filterUpcomingScheduledShifts(normalizeScheduledItems(data)).slice(0, limit)
}

export async function listScheduledShifts(limit = 50) {
  const data = await invokeEdge<unknown>("scheduled_shifts_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list",
      status: "scheduled",
      limit,
    },
  })
  return filterUpcomingScheduledShifts(normalizeScheduledItems(data)).slice(0, limit)
}

export async function cancelScheduledShift(scheduledShiftId: number, notes?: string) {
  await invokeEdge("scheduled_shifts_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "cancel",
      scheduled_shift_id: scheduledShiftId,
      reason: notes?.trim() || null,
    },
  })

  return {
    id: scheduledShiftId,
    employee_id: "",
    restaurant_id: 0,
    scheduled_start: "",
    scheduled_end: "",
    status: "cancelled",
    notes: notes?.trim() || null,
  } as ScheduledShift
}

export async function reprogramScheduledShift(payload: ReprogramScheduledShiftPayload) {
  const { scheduledShiftId, scheduledStartIso, scheduledEndIso, notes } = payload

  await invokeEdge("scheduled_shifts_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "reschedule",
      scheduled_shift_id: scheduledShiftId,
      scheduled_start: scheduledStartIso,
      scheduled_end: scheduledEndIso,
      notes: notes?.trim() || null,
    },
  })

  return {
    id: scheduledShiftId,
    employee_id: "",
    restaurant_id: 0,
    scheduled_start: scheduledStartIso,
    scheduled_end: scheduledEndIso,
    status: "scheduled",
    notes: notes?.trim() || null,
  } as ScheduledShift
}

export async function assignScheduledShiftsBulk(payload: {
  employeeId: string
  restaurantId: string
  blocks: Array<{ scheduledStartIso: string; scheduledEndIso: string }>
  notes?: string
}) {
  const blocks = payload.blocks.filter(item => item.scheduledStartIso && item.scheduledEndIso)
  if (blocks.length === 0) return [] as unknown[]

  return invokeEdge("scheduled_shifts_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "bulk_assign",
      entries: blocks.map(block => ({
        employee_id: payload.employeeId,
        restaurant_id: Number(payload.restaurantId),
        scheduled_start: block.scheduledStartIso,
        scheduled_end: block.scheduledEndIso,
        notes: payload.notes ?? null,
      })),
    },
  })
}

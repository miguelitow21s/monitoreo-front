import { invokeEdge } from "@/services/edgeClient"

let scheduledManageUnavailable = false

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return ""
}

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined
  const value = (error as { status?: unknown }).status
  return typeof value === "number" ? value : undefined
}

function isScheduledManageUnavailableError(error: unknown) {
  const message = toErrorMessage(error).toLowerCase()
  const status = getErrorStatus(error)

  if (status === 404) return true

  return (
    message.includes("scheduled_shifts_manage") &&
    (message.includes("failed to fetch") ||
      message.includes("cors") ||
      message.includes("preflight") ||
      message.includes("404") ||
      message.includes("not found"))
  )
}

function unavailableScheduledManageError() {
  return new Error(
    "El servicio de turnos programados no esta disponible (scheduled_shifts_manage). Verifica despliegue y CORS en Supabase Edge Functions."
  )
}

async function invokeScheduledManage<T>(body: Record<string, unknown>) {
  if (scheduledManageUnavailable) {
    throw unavailableScheduledManageError()
  }

  try {
    return await invokeEdge<T>("scheduled_shifts_manage", {
      idempotencyKey: crypto.randomUUID(),
      body,
    })
  } catch (error: unknown) {
    if (isScheduledManageUnavailableError(error)) {
      scheduledManageUnavailable = true
      throw unavailableScheduledManageError()
    }
    throw error
  }
}

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

  return invokeScheduledManage({
    action: "assign",
    employee_id: employeeId,
    restaurant_id: Number(restaurantId),
    scheduled_start: scheduledStartIso,
    scheduled_end: scheduledEndIso,
    notes: notes ?? null,
  })
}

function buildScheduledListBody(
  limit: number,
  restaurantId?: number | null,
  range?: { from?: string; to?: string; status?: string }
) {
  const body: Record<string, unknown> = {
    action: "list",
    status: range?.status ?? "scheduled",
    limit,
  }

  if (typeof restaurantId === "number" && Number.isFinite(restaurantId)) {
    body.restaurant_id = restaurantId
  }

  if (range?.from) body.from = range.from
  if (range?.to) body.to = range.to

  return body
}

export async function listMyScheduledShifts(limit = 10, restaurantId?: number | null) {
  const data = await invokeScheduledManage<unknown>(buildScheduledListBody(limit, restaurantId))
  return filterUpcomingScheduledShifts(normalizeScheduledItems(data)).slice(0, limit)
}

export async function listScheduledShifts(limit = 50, restaurantId?: number | null) {
  const data = await invokeScheduledManage<unknown>(buildScheduledListBody(limit, restaurantId))
  return filterUpcomingScheduledShifts(normalizeScheduledItems(data)).slice(0, limit)
}

export async function listScheduledShiftsAll(
  limit = 200,
  restaurantId?: number | null,
  range?: { from?: string; to?: string; status?: string }
) {
  const data = await invokeScheduledManage<unknown>(buildScheduledListBody(limit, restaurantId, range))
  const items = normalizeScheduledItems(data)
  return items
    .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime())
    .slice(0, limit)
}

export async function cancelScheduledShift(scheduledShiftId: number, notes?: string) {
  await invokeScheduledManage({
    action: "cancel",
    scheduled_shift_id: scheduledShiftId,
    reason: notes?.trim() || null,
  })
}

export async function reprogramScheduledShift(payload: ReprogramScheduledShiftPayload) {
  const { scheduledShiftId, scheduledStartIso, scheduledEndIso, notes } = payload

  await invokeScheduledManage({
    action: "reschedule",
    scheduled_shift_id: scheduledShiftId,
    scheduled_start: scheduledStartIso,
    scheduled_end: scheduledEndIso,
    notes: notes?.trim() || null,
  })
}

export async function assignScheduledShiftsBulk(payload: {
  employeeId: string
  restaurantId: string
  blocks: Array<{ scheduledStartIso: string; scheduledEndIso: string }>
  notes?: string
}) {
  const blocks = payload.blocks.filter(item => item.scheduledStartIso && item.scheduledEndIso)
  if (blocks.length === 0) return [] as unknown[]

  return invokeScheduledManage({
    action: "bulk_assign",
    entries: blocks.map(block => ({
      employee_id: payload.employeeId,
      restaurant_id: Number(payload.restaurantId),
      scheduled_start: block.scheduledStartIso,
      scheduled_end: block.scheduledEndIso,
      notes: payload.notes ?? null,
    })),
  })
}

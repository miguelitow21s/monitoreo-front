import { invokeEdge } from "@/services/edgeClient"

export interface Supply {
  id: string
  name: string
  unit: string
  stock: number
  unit_cost?: number | null
  restaurant_id: string | null
}

export interface SupplyDelivery {
  id: string
  supply_id: string
  restaurant_id: string
  quantity: number
  delivered_at: string
}

export interface SupplyDeliveryFilters {
  fromIso?: string
  toIso?: string
  restaurantId?: string
  limit?: number
}

function toStringId(value: unknown) {
  if (typeof value === "string" && value.trim().length > 0) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function toNumberValue(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function unwrapItems(payload: unknown) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== "object") return [] as unknown[]
  const wrapped = payload as { items?: unknown }
  return Array.isArray(wrapped.items) ? wrapped.items : []
}

function unwrapSingle(payload: unknown) {
  if (!payload || typeof payload !== "object") return payload
  if ("item" in (payload as Record<string, unknown>)) {
    return (payload as Record<string, unknown>).item
  }
  if ("supply" in (payload as Record<string, unknown>)) {
    return (payload as Record<string, unknown>).supply
  }
  return payload
}

function normalizeSupplyFromEdge(raw: unknown): Supply | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const id = toStringId(row.id)
  const name = typeof row.name === "string" ? row.name : null

  if (!id || !name) return null

  return {
    id,
    name,
    unit: typeof row.unit === "string" ? row.unit : "unit",
    stock: toNumberValue(row.stock),
    unit_cost: row.unit_cost === null ? null : toNumberValue(row.unit_cost, 0),
    restaurant_id: toStringId(row.restaurant_id),
  }
}

function normalizeDeliveryFromEdge(raw: unknown): SupplyDelivery | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>

  const id = toStringId(row.id)
  const supplyId = toStringId(row.supply_id)
  const restaurantId = toStringId(row.restaurant_id)
  const deliveredAt = typeof row.delivered_at === "string" ? row.delivered_at : null

  if (!id || !supplyId || !restaurantId || !deliveredAt) return null

  return {
    id,
    supply_id: supplyId,
    restaurant_id: restaurantId,
    quantity: toNumberValue(row.quantity),
    delivered_at: deliveredAt,
  }
}

export async function listSupplies(options?: { restaurantId?: string; limit?: number; search?: string }) {
  // Backend contract caps list limits at 200 for supplies.
  const edgeLimit = Math.max(1, Math.min(options?.limit ?? 200, 200))
  const payload = await invokeEdge<unknown>("supplies_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list",
      ...(options?.restaurantId ? { restaurant_id: Number(options.restaurantId) } : {}),
      ...(options?.search ? { search: options.search } : {}),
      limit: edgeLimit,
    },
  })

  return unwrapItems(payload)
    .map(normalizeSupplyFromEdge)
    .filter((item): item is Supply => item !== null)
}

export async function createSupply(payload: Omit<Supply, "id">) {
  const response = await invokeEdge<unknown>("supplies_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "create",
      ...payload,
      restaurant_id: payload.restaurant_id ? Number(payload.restaurant_id) : null,
    },
  })

  const normalized = normalizeSupplyFromEdge(unwrapSingle(response))
  if (!normalized) {
    throw new Error("Invalid supply payload from supplies_manage.create.")
  }
  return normalized
}

export async function updateSupply(id: string, payload: Partial<Omit<Supply, "id">>) {
  const response = await invokeEdge<unknown>("supplies_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "update",
      supply_id: id,
      ...payload,
      ...(payload.restaurant_id ? { restaurant_id: Number(payload.restaurant_id) } : {}),
    },
  })

  const normalized = normalizeSupplyFromEdge(unwrapSingle(response))
  if (!normalized) {
    throw new Error("Invalid supply payload from supplies_manage.update.")
  }
  return normalized
}

export async function registerSupplyDelivery(payload: {
  supply_id: string
  restaurant_id: string
  quantity: number
  delivered_at?: string
}) {
  const deliveredAt = payload.delivered_at ?? new Date().toISOString()
  const created = await invokeEdge<unknown>("supplies_deliver", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "deliver",
      supply_id: payload.supply_id,
      restaurant_id: Number(payload.restaurant_id),
      quantity: payload.quantity,
      delivered_at: deliveredAt,
    },
  })

  const normalized = normalizeDeliveryFromEdge(created)
  if (!normalized) {
    throw new Error("Invalid supply delivery payload from supplies_deliver.deliver.")
  }
  return normalized
}

export async function listSupplyDeliveries(limit = 30, options?: { restaurantId?: string; deliveredBy?: string }) {
  // Backend contract caps list limits at 200 for deliveries.
  const edgeLimit = Math.max(1, Math.min(limit, 200))
  const payload = await invokeEdge<unknown>("supplies_deliver", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list_deliveries",
      ...(options?.restaurantId ? { restaurant_id: Number(options.restaurantId) } : {}),
      ...(options?.deliveredBy ? { delivered_by: options.deliveredBy } : {}),
      limit: edgeLimit,
    },
  })

  return unwrapItems(payload)
    .map(normalizeDeliveryFromEdge)
    .filter((item): item is SupplyDelivery => item !== null)
}

export async function listSupplyDeliveriesByPeriod(filters: SupplyDeliveryFilters = {}) {
  const { fromIso, toIso, restaurantId } = filters
  const resultLimit = Math.max(1, Math.min(filters.limit ?? 2000, 5000))

  const rows = await listSupplyDeliveries(resultLimit, {
    restaurantId,
  })

  const fromMs = fromIso ? new Date(fromIso).getTime() : null
  const toMs = toIso ? new Date(toIso).getTime() : null

  return rows
    .filter(item => {
      const deliveredAtMs = new Date(item.delivered_at).getTime()
      if (!Number.isFinite(deliveredAtMs)) return false
      if (fromMs !== null && Number.isFinite(fromMs) && deliveredAtMs < fromMs) return false
      if (toMs !== null && Number.isFinite(toMs) && deliveredAtMs > toMs) return false
      return true
    })
    .slice(0, resultLimit)
}

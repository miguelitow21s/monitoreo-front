import { invokeEdge } from "@/services/edgeClient"
import { supabase } from "@/services/supabaseClient"

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

function shouldFallbackToDirectDb(error: unknown) {
  if (typeof error !== "object" || error === null) return true

  const status = (error as { status?: unknown }).status
  if (typeof status === "number") {
    if (status === 404 || status === 503) return true
    return false
  }

  const message =
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message.toLowerCase()
      : ""

  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("cors") ||
    message.includes("temporarily unavailable")
  )
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

function hasItemsPayload(payload: unknown) {
  if (Array.isArray(payload)) return true
  if (!payload || typeof payload !== "object") return false
  return Array.isArray((payload as { items?: unknown }).items)
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
  const edgeLimit = Math.max(1, Math.min(options?.limit ?? 200, 500))
  try {
    const payload = await invokeEdge<unknown>("supplies_deliver", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "list_supplies",
        ...(options?.restaurantId ? { restaurant_id: Number(options.restaurantId) } : {}),
        ...(options?.search ? { search: options.search } : {}),
        limit: edgeLimit,
      },
    })

    const rows = unwrapItems(payload)
      .map(normalizeSupplyFromEdge)
      .filter((item): item is Supply => item !== null)

    if (hasItemsPayload(payload)) {
      return rows
    }
  } catch (error: unknown) {
    if (!shouldFallbackToDirectDb(error)) throw error
  }

  const { data, error } = await supabase.from("supplies").select("*").order("name")
  if (error) throw error
  return (data ?? []) as Supply[]
}

export async function createSupply(payload: Omit<Supply, "id">) {
  const { data, error } = await supabase.from("supplies").insert(payload).select("*").single()
  if (error) throw error
  return data as Supply
}

export async function updateSupply(id: string, payload: Partial<Omit<Supply, "id">>) {
  const { data, error } = await supabase.from("supplies").update(payload).eq("id", id).select("*").single()
  if (error) throw error
  return data as Supply
}

export async function registerSupplyDelivery(payload: {
  supply_id: string
  restaurant_id: string
  quantity: number
  delivered_at?: string
}) {
  try {
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
    if (normalized) {
      return normalized
    }
  } catch (error: unknown) {
    if (!shouldFallbackToDirectDb(error)) throw error
  }

  const { data, error } = await supabase
    .from("supply_deliveries")
    .insert(payload)
    .select("*")
    .single()

  if (error) throw error
  return data as SupplyDelivery
}

export async function listSupplyDeliveries(limit = 30, options?: { restaurantId?: string; deliveredBy?: string }) {
  const edgeLimit = Math.max(1, Math.min(limit, 1000))
  try {
    const payload = await invokeEdge<unknown>("supplies_deliver", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "list_deliveries",
        ...(options?.restaurantId ? { restaurant_id: Number(options.restaurantId) } : {}),
        ...(options?.deliveredBy ? { delivered_by: options.deliveredBy } : {}),
        limit: edgeLimit,
      },
    })

    const rows = unwrapItems(payload)
      .map(normalizeDeliveryFromEdge)
      .filter((item): item is SupplyDelivery => item !== null)

    if (hasItemsPayload(payload)) {
      return rows
    }
  } catch (error: unknown) {
    if (!shouldFallbackToDirectDb(error)) throw error
  }

  const { data, error } = await supabase
    .from("supply_deliveries")
    .select("*")
    .order("delivered_at", { ascending: false })
    .limit(edgeLimit)

  if (error) throw error
  return (data ?? []) as SupplyDelivery[]
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

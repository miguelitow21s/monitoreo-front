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

export async function listSupplies() {
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
  const { data, error } = await supabase
    .from("supply_deliveries")
    .insert(payload)
    .select("*")
    .single()

  if (error) throw error
  return data as SupplyDelivery
}

export async function listSupplyDeliveries(limit = 30) {
  const { data, error } = await supabase
    .from("supply_deliveries")
    .select("*")
    .order("delivered_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as SupplyDelivery[]
}

export async function listSupplyDeliveriesByPeriod(filters: SupplyDeliveryFilters = {}) {
  const { fromIso, toIso, restaurantId } = filters
  const resultLimit = Math.max(1, Math.min(filters.limit ?? 2000, 5000))

  let query = supabase
    .from("supply_deliveries")
    .select("*")
    .order("delivered_at", { ascending: false })

  if (fromIso) query = query.gte("delivered_at", fromIso)
  if (toIso) query = query.lte("delivered_at", toIso)
  if (restaurantId) query = query.eq("restaurant_id", restaurantId)

  const { data, error } = await query.limit(resultLimit)
  if (error) throw error
  return (data ?? []) as SupplyDelivery[]
}

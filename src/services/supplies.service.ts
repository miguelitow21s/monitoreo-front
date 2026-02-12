import { supabase } from "@/services/supabaseClient"

export interface Supply {
  id: string
  name: string
  unit: string
  stock: number
  restaurant_id: string | null
}

export interface SupplyDelivery {
  id: string
  supply_id: string
  restaurant_id: string
  quantity: number
  delivered_at: string
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

import { supabase } from "@/services/supabaseClient"

export interface Restaurant {
  id: string
  name: string
  is_active?: boolean
  lat: number | null
  lng: number | null
  geofence_radius_m: number | null
  address_line?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
  country?: string | null
  place_id?: string | null
}

export interface RestaurantEmployee {
  id: string
  restaurant_id: string
  user_id: string
}

export interface SupervisorRestaurantOption {
  id: number
  name: string
}

export async function listRestaurants(options?: { includeInactive?: boolean }) {
  const includeInactive = options?.includeInactive === true
  let query = supabase.from("restaurants").select("*").order("name")
  if (!includeInactive) {
    query = query.eq("is_active", true)
  }

  const result = await query
  if (!result.error) {
    return (result.data ?? []) as Restaurant[]
  }

  const missingColumn = typeof result.error.message === "string" && result.error.message.includes("is_active")
  if (missingColumn) {
    const fallback = await supabase.from("restaurants").select("*").order("name")
    if (fallback.error) throw fallback.error
    return (fallback.data ?? []) as Restaurant[]
  }

  throw result.error
}

export async function createRestaurant(payload: Omit<Restaurant, "id">) {
  const { data, error } = await supabase.from("restaurants").insert(payload).select("*").single()
  if (error) throw error
  return data as Restaurant
}

export async function updateRestaurant(id: string, payload: Partial<Omit<Restaurant, "id">>) {
  const { data, error } = await supabase
    .from("restaurants")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single()

  if (error) throw error
  return data as Restaurant
}

export async function updateRestaurantStatus(id: string, isActive: boolean) {
  const { data, error } = await supabase
    .from("restaurants")
    .update({ is_active: isActive })
    .eq("id", id)
    .select("*")
    .single()

  if (error) throw error
  return data as Restaurant
}

export async function listRestaurantEmployees(restaurantId: string) {
  const { data, error } = await supabase
    .from("restaurant_employees")
    .select("*")
    .eq("restaurant_id", restaurantId)

  if (error) throw error
  return (data ?? []) as RestaurantEmployee[]
}

export async function assignEmployeeToRestaurant(restaurantId: string, userId: string) {
  const { data, error } = await supabase
    .from("restaurant_employees")
    .insert({ restaurant_id: restaurantId, user_id: userId })
    .select("*")
    .single()

  if (error) throw error
  return data as RestaurantEmployee
}

export async function listMySupervisorRestaurants() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user?.id) return [] as SupervisorRestaurantOption[]

  const { data: links, error: linksError } = await supabase
    .from("restaurant_employees")
    .select("restaurant_id")
    .eq("user_id", user.id)

  if (linksError) throw linksError

  const restaurantIds = Array.from(
    new Set(
      (links ?? [])
        .map(item => Number(item.restaurant_id))
        .filter(id => Number.isFinite(id))
    )
  )

  if (restaurantIds.length === 0) return [] as SupervisorRestaurantOption[]

  const { data: restaurants, error: restaurantsError } = await supabase
    .from("restaurants")
    .select("id,name")
    .in("id", restaurantIds)
    .order("name")

  if (restaurantsError) throw restaurantsError

  return (restaurants ?? [])
    .map(item => ({
      id: Number(item.id),
      name: String(item.name ?? `Restaurant #${item.id}`),
    }))
    .filter(item => Number.isFinite(item.id)) as SupervisorRestaurantOption[]
}

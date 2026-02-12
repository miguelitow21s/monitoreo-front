import { supabase } from "@/services/supabaseClient"

export interface Restaurant {
  id: string
  name: string
  lat: number | null
  lng: number | null
  geofence_radius_m: number | null
}

export interface RestaurantEmployee {
  id: string
  restaurant_id: string
  user_id: string
}

export async function listRestaurants() {
  const { data, error } = await supabase.from("restaurants").select("*").order("name")
  if (error) throw error
  return (data ?? []) as Restaurant[]
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

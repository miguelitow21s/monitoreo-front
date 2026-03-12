import { supabase } from "@/services/supabaseClient"
import { invokeEdge } from "@/services/edgeClient"

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
  role?: string | null
}

export interface SupervisorRestaurantOption {
  id: number
  name: string
}

function unwrapRestaurant(payload: unknown) {
  if (payload && typeof payload === "object" && "restaurant" in payload) {
    return (payload as { restaurant?: unknown }).restaurant ?? null
  }
  return payload
}

function normalizeStaffItems(payload: unknown, role: "employee" | "supervisor") {
  if (!payload || typeof payload !== "object") return [] as RestaurantEmployee[]
  const rawItems = Array.isArray((payload as { items?: unknown }).items)
    ? ((payload as { items?: unknown }).items as unknown[])
    : []

  const normalized: RestaurantEmployee[] = []
  for (const item of rawItems) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>

    if (role === "employee") {
      const employeeId = typeof row.employee_id === "string" ? row.employee_id : null
      const restaurantId = typeof row.restaurant_id === "number" ? String(row.restaurant_id) : null
      if (!employeeId || !restaurantId) continue

      normalized.push({
        id: `${restaurantId}:${employeeId}`,
        restaurant_id: restaurantId,
        user_id: employeeId,
        role: "empleado",
      })
      continue
    }

    const supervisorId = typeof row.supervisor_id === "string" ? row.supervisor_id : null
    const restaurantId = typeof row.restaurant_id === "number" ? String(row.restaurant_id) : null
    if (!supervisorId || !restaurantId) continue

    normalized.push({
      id: `${restaurantId}:${supervisorId}`,
      restaurant_id: restaurantId,
      user_id: supervisorId,
      role: "supervisora",
    })
  }

  return normalized
}

export async function listRestaurants(options?: { includeInactive?: boolean }) {
  const includeInactive = options?.includeInactive === true

  try {
    const payload = await invokeEdge<unknown>("admin_restaurants_manage", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "list",
        ...(includeInactive ? {} : { is_active: true }),
      },
    })

    const rows = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
        ? ((payload as { items?: unknown }).items as unknown[])
        : []

    if (Array.isArray(rows)) {
      return rows as Restaurant[]
    }
  } catch {
    // Fall through to direct DB access while backend rollout converges.
  }

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
  try {
    const created = await invokeEdge<unknown>("admin_restaurants_manage", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "create",
        name: payload.name,
        lat: payload.lat,
        lng: payload.lng,
        radius: payload.geofence_radius_m,
        address_line: payload.address_line ?? null,
        city: payload.city ?? null,
        state: payload.state ?? null,
        postal_code: payload.postal_code ?? null,
        country: payload.country ?? null,
        place_id: payload.place_id ?? null,
      },
    })

    const unwrapped = unwrapRestaurant(created)
    if (unwrapped && typeof unwrapped === "object") {
      return unwrapped as Restaurant
    }
  } catch {
    // Fall through to direct DB access while backend rollout converges.
  }

  const { data, error } = await supabase.from("restaurants").insert(payload).select("*").single()
  if (error) throw error
  return data as Restaurant
}

export async function updateRestaurant(id: string, payload: Partial<Omit<Restaurant, "id">>) {
  try {
    const updated = await invokeEdge<unknown>("admin_restaurants_manage", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "update",
        restaurant_id: Number(id),
        ...payload,
        ...(payload.geofence_radius_m === undefined ? {} : { radius: payload.geofence_radius_m }),
      },
    })

    const unwrapped = unwrapRestaurant(updated)
    if (unwrapped && typeof unwrapped === "object") {
      return unwrapped as Restaurant
    }
  } catch {
    // Fall through to direct DB access while backend rollout converges.
  }

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
  try {
    const updated = await invokeEdge<unknown>("admin_restaurants_manage", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: isActive ? "activate" : "deactivate",
        restaurant_id: Number(id),
      },
    })

    const unwrapped = unwrapRestaurant(updated)
    if (unwrapped && typeof unwrapped === "object") {
      return unwrapped as Restaurant
    }
  } catch {
    // Fall through to direct DB access while backend rollout converges.
  }

  const { data, error } = await supabase
    .from("restaurants")
    .update({ is_active: isActive })
    .eq("id", id)
    .select("*")
    .single()

  if (error) throw error
  return data as Restaurant
}

export async function listRestaurantEmployees(restaurantId: string, role?: "employee" | "supervisor") {
  const endpoint = role === "supervisor" ? "admin_supervisors_manage" : "restaurant_staff_manage"
  const scopedRole = role ?? "employee"
  const action = "list_by_restaurant"

  try {
    const payload = await invokeEdge<unknown>(endpoint, {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action,
        restaurant_id: Number(restaurantId),
      },
    })

    if (payload && typeof payload === "object" && "items" in payload) {
      return normalizeStaffItems(payload, scopedRole)
    }
  } catch {
    // Fall through to direct DB fallback below.
  }

  const { data, error } = await supabase
    .from("restaurant_employees")
    .select("*")
    .eq("restaurant_id", restaurantId)

  if (error) throw error

  const rows = (data ?? []) as RestaurantEmployee[]
  if (!role) return rows
  return rows.filter(item => (role === "supervisor" ? item.role === "supervisora" : item.role !== "supervisora"))
}

export async function assignEmployeeToRestaurant(
  restaurantId: string,
  userId: string,
  role: "employee" | "supervisor" = "employee"
) {
  const endpoint = role === "supervisor" ? "admin_supervisors_manage" : "restaurant_staff_manage"

  try {
    const created = await invokeEdge<unknown>(endpoint, {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: role === "supervisor" ? "assign" : "assign_employee",
        restaurant_id: Number(restaurantId),
        ...(role === "supervisor" ? { supervisor_id: userId } : { employee_id: userId }),
      },
    })

    if (created && typeof created === "object") {
      return created as RestaurantEmployee
    }
  } catch {
    // Fall through to direct DB fallback below.
  }

  const { data, error } = await supabase
    .from("restaurant_employees")
    .insert({ restaurant_id: restaurantId, user_id: userId })
    .select("*")
    .single()

  if (error) throw error
  return data as RestaurantEmployee
}

export async function unassignEmployeeFromRestaurant(
  restaurantId: string,
  userId: string,
  role: "employee" | "supervisor" = "employee"
) {
  const endpoint = role === "supervisor" ? "admin_supervisors_manage" : "restaurant_staff_manage"

  try {
    await invokeEdge(endpoint, {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: role === "supervisor" ? "unassign" : "unassign_employee",
        restaurant_id: Number(restaurantId),
        ...(role === "supervisor" ? { supervisor_id: userId } : { employee_id: userId }),
      },
    })
    return
  } catch {
    // Fall through to direct DB fallback below.
  }

  const { error } = await supabase
    .from("restaurant_employees")
    .delete()
    .eq("restaurant_id", restaurantId)
    .eq("user_id", userId)

  if (error) throw error
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

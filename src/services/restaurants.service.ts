import { invokeEdge } from "@/services/edgeClient"
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

function toNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null
}

function normalizeRestaurantRow(raw: unknown): Restaurant | null {
  if (!raw || typeof raw !== "object") return null
  const base = raw as Record<string, unknown>
  const unwrapped = unwrapRestaurant(base)
  const row = (unwrapped && typeof unwrapped === "object" ? (unwrapped as Record<string, unknown>) : base)

  const id = toNullableString(row.id) ?? (toNumberValue(row.id) !== null ? String(row.id) : null)
  if (!id) return null

  const name = toNullableString(row.name) ?? `Restaurant #${id}`

  return {
    id,
    name,
    is_active: typeof row.is_active === "boolean" ? row.is_active : undefined,
    lat: toNumberValue(row.lat),
    lng: toNumberValue(row.lng),
    geofence_radius_m: toNumberValue(row.geofence_radius_m ?? row.radius),
    address_line: toNullableString(row.address_line),
    city: toNullableString(row.city),
    state: toNullableString(row.state),
    postal_code: toNullableString(row.postal_code),
    country: toNullableString(row.country),
    place_id: toNullableString(row.place_id),
  }
}

function normalizeRestaurantsPayload(payload: unknown) {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? ((payload as { items?: unknown }).items as unknown[])
      : []

  return rows.map(normalizeRestaurantRow).filter((item): item is Restaurant => item !== null)
}

function isForbiddenError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const status = (error as { status?: unknown }).status
  return typeof status === "number" && status === 403
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

export async function listRestaurants(options?: { includeInactive?: boolean; useAdminApi?: boolean }) {
  const includeInactive = options?.includeInactive === true

  const callAdmin = async () => {
    const payload = await invokeEdge<unknown>("admin_restaurants_manage", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "list",
        ...(includeInactive ? {} : { is_active: true }),
      },
    })
    return normalizeRestaurantsPayload(payload)
  }

  if (options?.useAdminApi) {
    return callAdmin()
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const roleFromMetadata =
    (typeof session?.user?.user_metadata?.role === "string" ? session?.user?.user_metadata?.role : null) ??
    (typeof (session?.user?.app_metadata as { role?: unknown })?.role === "string"
      ? ((session?.user?.app_metadata as { role?: string }).role ?? null)
      : null)
  if (roleFromMetadata && roleFromMetadata.toLowerCase().includes("admin")) {
    return callAdmin()
  }

  try {
    const payload = await invokeEdge<unknown>("restaurant_staff_manage", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "list_my_restaurants",
        ...(includeInactive ? {} : { is_active: true }),
      },
    })
    return normalizeRestaurantsPayload(payload)
  } catch (error: unknown) {
    if (!isForbiddenError(error)) throw error
    return callAdmin()
  }
}

export async function createRestaurant(payload: Omit<Restaurant, "id">) {
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

  const normalized = normalizeRestaurantRow(created)
  if (!normalized) {
    throw new Error("Invalid restaurant payload from admin_restaurants_manage.")
  }
  return normalized
}

export async function updateRestaurant(id: string, payload: Partial<Omit<Restaurant, "id">>) {
  const updated = await invokeEdge<unknown>("admin_restaurants_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "update",
      restaurant_id: Number(id),
      ...payload,
      ...(payload.geofence_radius_m === undefined ? {} : { radius: payload.geofence_radius_m }),
    },
  })

  const normalized = normalizeRestaurantRow(updated)
  if (!normalized) {
    throw new Error("Invalid restaurant payload from admin_restaurants_manage.")
  }
  return normalized
}

export async function updateRestaurantStatus(id: string, isActive: boolean) {
  const updated = await invokeEdge<unknown>("admin_restaurants_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: isActive ? "activate" : "deactivate",
      restaurant_id: Number(id),
    },
  })

  const normalized = normalizeRestaurantRow(updated)
  if (!normalized) {
    throw new Error("Invalid restaurant payload from admin_restaurants_manage.")
  }
  return normalized
}

export async function listRestaurantEmployees(restaurantId: string, role?: "employee" | "supervisor") {
  const endpoint = role === "supervisor" ? "admin_supervisors_manage" : "restaurant_staff_manage"
  const scopedRole = role ?? "employee"
  const action = "list_by_restaurant"

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

  return [] as RestaurantEmployee[]
}

export async function assignEmployeeToRestaurant(
  restaurantId: string,
  userId: string,
  role: "employee" | "supervisor" = "employee"
) {
  const endpoint = role === "supervisor" ? "admin_supervisors_manage" : "restaurant_staff_manage"

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

  throw new Error("Invalid response from restaurant staff assignment.")
}

export async function unassignEmployeeFromRestaurant(
  restaurantId: string,
  userId: string,
  role: "employee" | "supervisor" = "employee"
) {
  const endpoint = role === "supervisor" ? "admin_supervisors_manage" : "restaurant_staff_manage"

  await invokeEdge(endpoint, {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: role === "supervisor" ? "unassign" : "unassign_employee",
      restaurant_id: Number(restaurantId),
      ...(role === "supervisor" ? { supervisor_id: userId } : { employee_id: userId }),
    },
  })
}

export async function listMySupervisorRestaurants() {
  const rows = await listRestaurants()
  return rows
    .map(item => ({
      id: Number(item.id),
      name: item.name ?? `Restaurant #${item.id}`,
    }))
    .filter(item => Number.isFinite(item.id)) as SupervisorRestaurantOption[]
}

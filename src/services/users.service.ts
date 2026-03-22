import { supabase } from "@/services/supabaseClient"
import { invokeEdge } from "@/services/edgeClient"
import { ROLES, Role } from "@/utils/permissions"
import { normalizePhoneForOtp } from "@/utils/phone"

let bootstrapEdgeUnavailable = false
let bootstrapEdgeAttempted = false

function isRpcUnavailableError(error: unknown) {
  if (!error || typeof error !== "object") return false

  const candidate = error as { message?: unknown; code?: unknown; status?: unknown; details?: unknown; hint?: unknown }
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : ""
  const details = typeof candidate.details === "string" ? candidate.details.toLowerCase() : ""
  const hint = typeof candidate.hint === "string" ? candidate.hint.toLowerCase() : ""
  const code = typeof candidate.code === "string" ? candidate.code.toLowerCase() : ""
  const status = typeof candidate.status === "number" ? candidate.status : undefined

  return (
    status === 404 ||
    code === "pgrst202" ||
    message.includes("could not find") ||
    message.includes("does not exist") ||
    message.includes("404") ||
    details.includes("could not find") ||
    details.includes("does not exist") ||
    hint.includes("could not find") ||
    hint.includes("does not exist")
  )
}

function isBootstrapSkippableError(error: unknown) {
  if (!error || typeof error !== "object") return false

  const candidate = error as { message?: unknown; status?: unknown; details?: unknown; hint?: unknown }
  const status = typeof candidate.status === "number" ? candidate.status : undefined
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : ""
  const details = typeof candidate.details === "string" ? candidate.details.toLowerCase() : ""
  const hint = typeof candidate.hint === "string" ? candidate.hint.toLowerCase() : ""

  return (
    status === 400 ||
    status === 404 ||
    status === 405 ||
    message.includes("method not allowed") ||
    message.includes("metodo no permitido") ||
    details.includes("method not allowed") ||
    details.includes("metodo no permitido") ||
    hint.includes("method not allowed") ||
    hint.includes("metodo no permitido")
  )
}

export interface UserProfile {
  id: string
  full_name: string | null
  first_name?: string | null
  last_name?: string | null
  phone_number?: string | null
  email: string | null
  role: Role | null
  is_active: boolean | null
}

interface UsersManageEnvelope {
  items?: unknown
  user?: unknown
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null
}

function normalizeUserProfile(raw: unknown): UserProfile | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const id = toNullableString(row.id)
  if (!id) return null

  return {
    id,
    full_name: toNullableString(row.full_name),
    first_name: toNullableString(row.first_name),
    last_name: toNullableString(row.last_name),
    phone_number: toNullableString(row.phone_number),
    email: toNullableString(row.email),
    role: (toNullableString(row.role) as Role | null) ?? null,
    is_active: typeof row.is_active === "boolean" ? row.is_active : null,
  }
}

function unwrapUserPayload(payload: unknown) {
  if (payload && typeof payload === "object" && "user" in payload) {
    return (payload as UsersManageEnvelope).user ?? null
  }
  return payload
}

function normalizeUserProfiles(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload.map(normalizeUserProfile).filter((item): item is UserProfile => item !== null)
  }

  if (!payload || typeof payload !== "object") return [] as UserProfile[]
  const wrapped = payload as UsersManageEnvelope
  const source = Array.isArray(wrapped.items) ? wrapped.items : []
  return source.map(normalizeUserProfile).filter((item): item is UserProfile => item !== null)
}

export async function listUserProfiles(options?: {
  useAdminApi?: boolean
  restaurantId?: number | string | null
  limit?: number
}) {
  if (options?.useAdminApi) {
    const payload = await invokeEdge<unknown>("admin_users_manage", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "list",
      },
    })

    const rows = normalizeUserProfiles(payload)
    return rows.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""))
  }

  const payload = await invokeEdge<unknown>("restaurant_staff_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list_assignable_employees",
      ...(options?.restaurantId ? { restaurant_id: Number(options.restaurantId) } : {}),
      ...(typeof options?.limit === "number" ? { limit: options.limit } : {}),
    },
  })

  const rows = normalizeUserProfiles(payload)
  return rows.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""))
}

export async function updateUserProfileRole(id: string, role: Role) {
  const payload = await invokeEdge<unknown>("admin_users_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "update",
      user_id: id,
      role,
    },
  })

  const updated = normalizeUserProfile(unwrapUserPayload(payload))
  if (!updated) {
    throw new Error("Invalid user payload from admin_users_manage.")
  }
  return updated
}

export async function updateUserProfileStatus(id: string, isActive: boolean) {
  const payload = await invokeEdge<unknown>("admin_users_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: isActive ? "activate" : "deactivate",
      user_id: id,
      ...(isActive ? {} : { reason: "deactivated_from_frontend" }),
    },
  })

  const updated = normalizeUserProfile(unwrapUserPayload(payload))
  if (!updated) {
    throw new Error("Invalid user payload from admin_users_manage.")
  }
  return updated
}

export async function createAdminUser(payload: {
  email: string
  fullName: string
  role: Role
  phoneNumber?: string | null
}) {
  const normalizedPhone = payload.phoneNumber ? normalizePhoneForOtp(payload.phoneNumber) : null
  const requiresPhone = payload.role === ROLES.EMPLEADO || payload.role === ROLES.SUPERVISORA
  if (requiresPhone && !normalizedPhone) {
    throw new Error("Phone number is required in E.164 format for employee/supervisor users.")
  }

  const [firstNameRaw, ...lastNameChunks] = payload.fullName.trim().split(/\s+/)
  const firstName = firstNameRaw || "Usuario"
  const lastName = lastNameChunks.join(" ") || "Nuevo"

  const created = await invokeEdge<unknown>("admin_users_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "create",
      email: payload.email.trim(),
      role: payload.role,
      first_name: firstName,
      last_name: lastName,
      phone_number: normalizedPhone,
      is_active: true,
    },
  })

  const normalized = normalizeUserProfile(unwrapUserPayload(created))
  if (!normalized) {
    throw new Error("Could not parse created user payload from admin_users_manage.")
  }

  return normalized
}

export async function bootstrapMyUserProfile() {
  if (bootstrapEdgeUnavailable || bootstrapEdgeAttempted) return
  bootstrapEdgeAttempted = true

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) return

  try {
    await invokeEdge("users_bootstrap", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "bootstrap_my_user",
      },
    })
  } catch (error: unknown) {
    if (isRpcUnavailableError(error) || isBootstrapSkippableError(error)) {
      bootstrapEdgeUnavailable = true
      return
    }
    throw error
  }
}

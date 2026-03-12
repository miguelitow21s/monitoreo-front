import { supabase } from "@/services/supabaseClient"
import { invokeEdge } from "@/services/edgeClient"
import { Role } from "@/utils/permissions"

let bootstrapRpcUnavailable = false

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

export async function listUserProfiles(options?: { useAdminApi?: boolean }) {
  if (options?.useAdminApi) {
    try {
      const payload = await invokeEdge<unknown>("admin_users_manage", {
        idempotencyKey: crypto.randomUUID(),
        body: {
          action: "list",
        },
      })

      const rows = normalizeUserProfiles(payload)
      if (Array.isArray(rows)) {
        return rows.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""))
      }
    } catch {
      // Fall through to direct query for backward compatibility while backend rollout converges.
    }
  }

  const { data, error } = await supabase.from("profiles").select("*").order("full_name")
  if (error) throw error
  return (data ?? []) as UserProfile[]
}

export async function updateUserProfileRole(id: string, role: Role) {
  try {
    const payload = await invokeEdge<unknown>("admin_users_manage", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "update",
        user_id: id,
        role,
      },
    })

    const updated = normalizeUserProfile(unwrapUserPayload(payload))
    if (updated) return updated
  } catch {
    // Keep compatibility with current direct DB fallback.
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", id)
    .select("*")
    .single()

  if (error) throw error
  return data as UserProfile
}

export async function updateUserProfileStatus(id: string, isActive: boolean) {
  try {
    const payload = await invokeEdge<unknown>("admin_users_manage", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: isActive ? "activate" : "deactivate",
        user_id: id,
        ...(isActive ? {} : { reason: "deactivated_from_frontend" }),
      },
    })

    const updated = normalizeUserProfile(unwrapUserPayload(payload))
    if (updated) return updated
  } catch {
    // Keep compatibility with current direct DB fallback.
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", id)
    .select("*")
    .single()

  if (error) throw error
  return data as UserProfile
}

export async function createAdminUser(payload: {
  email: string
  fullName: string
  role: Role
  phoneNumber?: string | null
}) {
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
      phone_number: payload.phoneNumber?.trim() || null,
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
  if (bootstrapRpcUnavailable) return

  const { error } = await supabase.rpc("bootstrap_my_user", {})
  if (error) {
    if (isRpcUnavailableError(error)) {
      bootstrapRpcUnavailable = true
      return
    }
    throw error
  }
}

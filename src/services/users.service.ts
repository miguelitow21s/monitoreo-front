import { supabase } from "@/services/supabaseClient"
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

export async function listUserProfiles() {
  const { data, error } = await supabase.from("profiles").select("*").order("full_name")
  if (error) throw error
  return (data ?? []) as UserProfile[]
}

export async function updateUserProfileRole(id: string, role: Role) {
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
  const { data, error } = await supabase
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", id)
    .select("*")
    .single()

  if (error) throw error
  return data as UserProfile
}

export async function bootstrapMyUserProfile() {
  if (bootstrapRpcUnavailable) return

  const { error } = await supabase.rpc("bootstrap_my_user")
  if (error) {
    if (isRpcUnavailableError(error)) {
      bootstrapRpcUnavailable = true
      return
    }
    throw error
  }
}

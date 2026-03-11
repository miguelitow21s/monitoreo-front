import { supabase } from "@/services/supabaseClient"
import { Role } from "@/utils/permissions"

let bootstrapRpcUnavailable = false

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
    const message = typeof error.message === "string" ? error.message.toLowerCase() : ""
    if (message.includes("could not find") || message.includes("does not exist") || message.includes("404")) {
      bootstrapRpcUnavailable = true
      return
    }
    throw error
  }
}

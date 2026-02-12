import { supabase } from "@/services/supabaseClient"
import { Role } from "@/utils/permissions"

export interface UserProfile {
  id: string
  full_name: string | null
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

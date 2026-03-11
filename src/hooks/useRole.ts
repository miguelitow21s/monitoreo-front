"use client"

import { useEffect, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/services/supabaseClient"
import { ROLES, Role } from "@/utils/permissions"

export function useRole() {
  const { user, loading } = useAuth()
  const [profileRole, setProfileRole] = useState<Role | null>(null)
  const [loadingRole, setLoadingRole] = useState(true)

  useEffect(() => {
    let mounted = true

    const loadRoleFromProfile = async () => {
      if (!user?.id) {
        setProfileRole(null)
        setLoadingRole(false)
        return
      }

      setLoadingRole(true)

      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()

      if (!mounted) return
      setProfileRole((data?.role as Role | undefined) ?? null)
      setLoadingRole(false)
    }

    void loadRoleFromProfile()

    return () => {
      mounted = false
    }
  }, [user?.id])

  const metadataRole = user?.user_metadata?.role as Role | undefined
  // Source of truth is profiles.role (updated by admin flows). Metadata is fallback only.
  const role = profileRole ?? metadataRole ?? undefined

  return {
    role,
    loading: loading || loadingRole,
    isSuperAdmin: role === ROLES.SUPER_ADMIN,
    isSupervisora: role === ROLES.SUPERVISORA,
    isEmpleado: role === ROLES.EMPLEADO,
  }
}

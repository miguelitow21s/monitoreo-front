"use client"

import { useEffect, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/services/supabaseClient"
import { ROLES, Role } from "@/utils/permissions"

export function useRole() {
  const { user, loading } = useAuth()
  const [profileRole, setProfileRole] = useState<Role | null>(null)

  useEffect(() => {
    let mounted = true

    const loadRoleFromProfile = async () => {
      if (!user?.id) {
        setProfileRole(null)
        return
      }

      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()

      if (!mounted) return
      setProfileRole((data?.role as Role | undefined) ?? null)
    }

    void loadRoleFromProfile()

    return () => {
      mounted = false
    }
  }, [user?.id])

  const metadataRole = user?.user_metadata?.role as Role | undefined
  const role = metadataRole ?? profileRole ?? undefined

  return {
    role,
    loading,
    isSuperAdmin: role === ROLES.SUPER_ADMIN,
    isSupervisora: role === ROLES.SUPERVISORA,
    isEmpleado: role === ROLES.EMPLEADO,
  }
}

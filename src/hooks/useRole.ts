"use client"

import { useEffect, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/services/supabaseClient"
import { ROLES, Role } from "@/utils/permissions"

function normalizeRole(value: unknown): Role | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()

  if (normalized === ROLES.SUPER_ADMIN || normalized === "superadmin" || normalized === "admin") {
    return ROLES.SUPER_ADMIN
  }

  if (
    normalized === ROLES.SUPERVISORA ||
    normalized === "supervisor" ||
    normalized === "coordinadora" ||
    normalized === "coordinator"
  ) {
    return ROLES.SUPERVISORA
  }

  if (normalized === ROLES.EMPLEADO || normalized === "employee" || normalized === "empleado_aseo") {
    return ROLES.EMPLEADO
  }

  return undefined
}

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
      setProfileRole(normalizeRole(data?.role) ?? null)
      setLoadingRole(false)
    }

    void loadRoleFromProfile()

    return () => {
      mounted = false
    }
  }, [user?.id])

  const metadataRole = normalizeRole(user?.user_metadata?.role)
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

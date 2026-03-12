"use client"

import { useEffect, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/services/supabaseClient"
import { ROLES, Role } from "@/utils/permissions"

function normalizeRole(value: unknown): Role | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  const compact = normalized.replace(/\s+/g, "_")

  if (
    compact === ROLES.SUPER_ADMIN ||
    compact === "superadmin" ||
    compact === "admin" ||
    compact.includes("super_admin") ||
    compact.includes("superadmin")
  ) {
    return ROLES.SUPER_ADMIN
  }

  if (
    normalized.includes(ROLES.SUPERVISORA) ||
    normalized.includes("supervisor") ||
    normalized.includes("supervisors") ||
    normalized.includes("coordinadora") ||
    normalized.includes("coordinador") ||
    normalized.includes("coordinator")
  ) {
    return ROLES.SUPERVISORA
  }

  if (
    normalized.includes(ROLES.EMPLEADO) ||
    normalized.includes("employee") ||
    normalized.includes("empleado_aseo")
  ) {
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
    let roleChannel: ReturnType<typeof supabase.channel> | null = null

    const loadRoleFromProfile = async () => {
      if (!user?.id) {
        setProfileRole(null)
        setLoadingRole(false)
        return
      }

      setLoadingRole(true)

      const { data, error } = await supabase
        .from("profiles")
        .select("role,is_active")
        .eq("id", user.id)
        .maybeSingle()

      if (!mounted) return
      if (!error) {
        if (data?.is_active === false) {
          setProfileRole(null)
          await supabase.auth.signOut()
          setLoadingRole(false)
          return
        }
        setProfileRole(normalizeRole(data?.role) ?? null)
      } else {
        setProfileRole(null)
      }
      setLoadingRole(false)

      roleChannel = supabase
        .channel(`role-profile-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${user.id}`,
          },
          payload => {
            if (!mounted) return
            if ((payload.new as { is_active?: unknown } | null)?.is_active === false) {
              setProfileRole(null)
              void supabase.auth.signOut()
              return
            }
            const nextRole = normalizeRole((payload.new as { role?: unknown } | null)?.role)
            setProfileRole(nextRole ?? null)
          }
        )
        .subscribe()
    }

    void loadRoleFromProfile()

    return () => {
      mounted = false
      if (roleChannel) {
        void supabase.removeChannel(roleChannel)
      }
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

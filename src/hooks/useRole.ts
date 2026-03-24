"use client"

import { useEffect, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/services/supabaseClient"
import { debugLog } from "@/services/debug"
import { getMyUserProfile } from "@/services/users.service"
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

function toErrorSnapshot(error: unknown) {
  if (!error || typeof error !== "object") return null
  const candidate = error as { message?: unknown; code?: unknown; status?: unknown; details?: unknown; hint?: unknown }
  return {
    message: typeof candidate.message === "string" ? candidate.message : null,
    code: typeof candidate.code === "string" ? candidate.code : null,
    status: typeof candidate.status === "number" ? candidate.status : null,
    details: typeof candidate.details === "string" ? candidate.details : null,
    hint: typeof candidate.hint === "string" ? candidate.hint : null,
  }
}

export function useRole() {
  const { user, loading } = useAuth()
  const [profileRole, setProfileRole] = useState<Role | null>(null)
  const [profileIsActive, setProfileIsActive] = useState<boolean | null>(null)
  const [loadingRole, setLoadingRole] = useState(true)
  const [lastProfileFetchUserId, setLastProfileFetchUserId] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const loadRoleFromProfile = async () => {
      if (!user?.id) {
        setProfileRole(null)
        setProfileIsActive(null)
        setLoadingRole(false)
        setLastProfileFetchUserId(null)
        return
      }

      setLoadingRole(true)

      if (lastProfileFetchUserId === user.id) {
        setLoadingRole(false)
        return
      }

      try {
        const profile = await getMyUserProfile()
        if (!mounted) return

        const normalizedRole = normalizeRole(profile.role)
        setProfileRole(normalizedRole ?? null)
        setProfileIsActive(profile.is_active ?? null)

        if (profile.is_active === false) {
          setLastProfileFetchUserId(user.id)
          await supabase.auth.signOut()
          setLoadingRole(false)
          return
        }

        setLastProfileFetchUserId(user.id)
        setLoadingRole(false)
        return
      } catch (error: unknown) {
        debugLog("role.me_error", { userId: user.id, error: toErrorSnapshot(error) })
      }

      setLastProfileFetchUserId(user.id)
      setProfileRole(null)
      setProfileIsActive(null)
      setLoadingRole(false)
    }

    void loadRoleFromProfile()

    return () => {
      mounted = false
    }
  }, [user?.id, lastProfileFetchUserId])

  const role = profileRole ?? undefined
  const pendingRole = !!user?.id && lastProfileFetchUserId !== user.id
  const combinedLoading = loading || loadingRole || pendingRole

  useEffect(() => {
    debugLog("role.snapshot", {
      userId: user?.id ?? null,
      profileRole,
      profileIsActive,
      role,
      pendingRole,
      loading: combinedLoading,
    })
  }, [combinedLoading, pendingRole, profileIsActive, profileRole, role, user?.id])

  return {
    role,
    loading: combinedLoading,
    isSuperAdmin: role === ROLES.SUPER_ADMIN,
    isSupervisora: role === ROLES.SUPERVISORA,
    isEmpleado: role === ROLES.EMPLEADO,
  }
}

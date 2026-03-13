"use client"

import { useEffect, useRef, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/services/supabaseClient"
import { debugLog } from "@/services/debug"
import { bootstrapMyUserProfile } from "@/services/users.service"
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
  const [loadingRole, setLoadingRole] = useState(true)
  const bootstrapAttemptedRef = useRef(false)

  useEffect(() => {
    let mounted = true

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

      debugLog("role.profile_fetch", {
        userId: user.id,
        hasProfileRow: !!data,
        dataRole: data?.role ?? null,
        isActive: data?.is_active ?? null,
        error: toErrorSnapshot(error),
      })

      if (error) {
        setProfileRole(null)
        setLoadingRole(false)
        return
      }

      if (!data && !bootstrapAttemptedRef.current) {
        bootstrapAttemptedRef.current = true
        debugLog("role.bootstrap_attempt", { userId: user.id })

        try {
          await bootstrapMyUserProfile()
        } catch (bootstrapError: unknown) {
          debugLog("role.bootstrap_error", { userId: user.id, error: toErrorSnapshot(bootstrapError) })
        }

        if (!mounted) return

        const { data: retryData, error: retryError } = await supabase
          .from("profiles")
          .select("role,is_active")
          .eq("id", user.id)
          .maybeSingle()

        if (!mounted) return

        debugLog("role.profile_retry", {
          userId: user.id,
          hasProfileRow: !!retryData,
          dataRole: retryData?.role ?? null,
          isActive: retryData?.is_active ?? null,
          error: toErrorSnapshot(retryError),
        })

        if (retryError) {
          setProfileRole(null)
          setLoadingRole(false)
          return
        }

        if (retryData?.is_active === false) {
          setProfileRole(null)
          await supabase.auth.signOut()
          setLoadingRole(false)
          return
        }

        setProfileRole(normalizeRole(retryData?.role) ?? null)
        setLoadingRole(false)
        return
      }

      if (data?.is_active === false) {
        setProfileRole(null)
        await supabase.auth.signOut()
        setLoadingRole(false)
        return
      }

      setProfileRole(normalizeRole(data?.role) ?? null)
      setLoadingRole(false)
    }

    void loadRoleFromProfile()

    return () => {
      mounted = false
    }
  }, [user?.id])

  const metadataRole = normalizeRole(user?.user_metadata?.role)
  // Source of truth is profiles.role for authenticated users.
  // Metadata fallback is only used before authentication is established.
  const role = user?.id ? profileRole ?? undefined : metadataRole ?? undefined

  useEffect(() => {
    debugLog("role.snapshot", {
      userId: user?.id ?? null,
      profileRole,
      metadataRole,
      role,
    })
  }, [metadataRole, profileRole, role, user?.id])

  return {
    role,
    loading: loading || loadingRole,
    isSuperAdmin: role === ROLES.SUPER_ADMIN,
    isSupervisora: role === ROLES.SUPERVISORA,
    isEmpleado: role === ROLES.EMPLEADO,
  }
}

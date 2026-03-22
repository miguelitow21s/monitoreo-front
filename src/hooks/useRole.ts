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
  const [lastProfileFetchUserId, setLastProfileFetchUserId] = useState<string | null>(null)
  const bootstrapAttemptedRef = useRef(false)

  useEffect(() => {
    let mounted = true

    const loadRoleFromProfile = async () => {
      if (!user?.id) {
        setProfileRole(null)
        setLoadingRole(false)
        setLastProfileFetchUserId(null)
        return
      }

      setLoadingRole(true)

      const roleFromMetadata = normalizeRole(
        (user.user_metadata?.role as string | undefined) ?? (user.app_metadata?.role as string | undefined)
      )
      const isActiveFromMetadata =
        typeof user.user_metadata?.is_active === "boolean"
          ? user.user_metadata.is_active
          : typeof (user.app_metadata as { is_active?: unknown })?.is_active === "boolean"
            ? (user.app_metadata as { is_active?: boolean }).is_active
            : undefined

      if (!mounted) return

      debugLog("role.metadata_fetch", {
        userId: user.id,
        role: roleFromMetadata ?? null,
        isActive: isActiveFromMetadata ?? null,
      })

      if (isActiveFromMetadata === false) {
        setLastProfileFetchUserId(user.id)
        setProfileRole(null)
        await supabase.auth.signOut()
        setLoadingRole(false)
        return
      }

      if (roleFromMetadata) {
        setLastProfileFetchUserId(user.id)
        setProfileRole(roleFromMetadata)
        setLoadingRole(false)
        return
      }

      if (!bootstrapAttemptedRef.current) {
        bootstrapAttemptedRef.current = true
        debugLog("role.bootstrap_attempt", { userId: user.id })

        try {
          await bootstrapMyUserProfile()
        } catch (bootstrapError: unknown) {
          debugLog("role.bootstrap_error", { userId: user.id, error: toErrorSnapshot(bootstrapError) })
        }
      }

      setLastProfileFetchUserId(user.id)
      setProfileRole(null)
      setLoadingRole(false)
    }

    void loadRoleFromProfile()

    return () => {
      mounted = false
    }
  }, [user?.id, user?.user_metadata?.role, user?.app_metadata?.role])

  const metadataRole = normalizeRole(
    (user?.user_metadata?.role as string | undefined) ?? (user?.app_metadata?.role as string | undefined)
  )
  const role = profileRole ?? metadataRole ?? undefined
  const pendingRole = !!user?.id && lastProfileFetchUserId !== user.id
  const combinedLoading = loading || loadingRole || pendingRole

  useEffect(() => {
    debugLog("role.snapshot", {
      userId: user?.id ?? null,
      profileRole,
      metadataRole,
      role,
      pendingRole,
      loading: combinedLoading,
    })
  }, [combinedLoading, metadataRole, pendingRole, profileRole, role, user?.id])

  return {
    role,
    loading: combinedLoading,
    isSuperAdmin: role === ROLES.SUPER_ADMIN,
    isSupervisora: role === ROLES.SUPERVISORA,
    isEmpleado: role === ROLES.EMPLEADO,
  }
}

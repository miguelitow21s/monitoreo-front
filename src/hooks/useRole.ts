"use client"

import { useAuth } from "@/hooks/useAuth"
import { ROLES, Role } from "@/utils/permissions"

export function useRole() {
  const { user, loading } = useAuth()

  const role = user?.user_metadata?.role as Role | undefined

  return {
    role,
    loading,
    isSuperAdmin: role === ROLES.SUPER_ADMIN,
    isSupervisora: role === ROLES.SUPERVISORA,
    isEmpleado: role === ROLES.EMPLEADO,
  }
}

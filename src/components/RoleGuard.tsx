"use client"

import { ReactNode } from "react"
import { useAuth } from "@/hooks/useAuth"
import { Role } from "@/utils/permissions"

interface RoleGuardProps {
  allowedRoles: Role[]
  children: ReactNode
}

export default function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const { user, loading } = useAuth()

  if (loading) return null

  const role = user?.user_metadata?.role as Role | undefined

  if (!role || !allowedRoles.includes(role)) {
    return null
  }

  return <>{children}</>
}

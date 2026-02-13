"use client"

import { ReactNode, useEffect } from "react"
import { useRouter } from "next/navigation"

import { useRole } from "@/hooks/useRole"
import { Role } from "@/utils/permissions"

interface RoleGuardProps {
  allowedRoles: Role[]
  children: ReactNode
}

export default function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const router = useRouter()
  const { role, loading } = useRole()
  const allowed = !!role && allowedRoles.includes(role)

  useEffect(() => {
    if (!loading && !allowed) {
      router.replace("/unauthorized")
    }
  }, [loading, allowed, router])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-gray-500">
        Verificando permisos...
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-gray-500">
        Redirigiendo...
      </div>
    )
  }

  return <>{children}</>
}

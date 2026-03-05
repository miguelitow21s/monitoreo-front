"use client"

import { ReactNode, useEffect } from "react"
import { useRouter } from "next/navigation"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"

interface ProtectedRouteProps {
  children: ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const router = useRouter()
  const { loading, isAuthenticated } = useAuth()
  const { t } = useI18n()

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace("/auth/login")
    }
  }, [loading, isAuthenticated, router])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-gray-500">
        {t("Cargando sesion...", "Loading session...")}
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-gray-500">
        {t("Redirigiendo a login...", "Redirecting to login...")}
      </div>
    )
  }

  return <>{children}</>
}

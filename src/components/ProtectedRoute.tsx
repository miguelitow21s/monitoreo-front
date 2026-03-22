"use client"

import { ReactNode, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { getMyUserProfile } from "@/services/users.service"

interface ProtectedRouteProps {
  children: ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const router = useRouter()
  const { loading, isAuthenticated } = useAuth()
  const { t } = useI18n()
  const [bootstrapping, setBootstrapping] = useState(true)

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace("/auth/login")
    }
  }, [loading, isAuthenticated, router])

  useEffect(() => {
    let mounted = true

    const bootstrap = async () => {
      if (loading) return
      if (!isAuthenticated) {
        if (mounted) setBootstrapping(false)
        return
      }

      try {
        await getMyUserProfile()
      } catch {
        // If backend still lacks the RPC, page access continues.
      } finally {
        if (mounted) setBootstrapping(false)
      }
    }

    void bootstrap()
    return () => {
      mounted = false
    }
  }, [loading, isAuthenticated])

  if (loading || bootstrapping) {
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

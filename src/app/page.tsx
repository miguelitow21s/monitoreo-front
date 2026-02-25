"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"

export default function HomePage() {
  const router = useRouter()
  const { session, loading } = useAuth()
  const { t } = useI18n()

  useEffect(() => {
    if (loading) return
    router.replace(session ? "/dashboard" : "/auth/login")
  }, [loading, session, router])

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
      {t("Redirigiendo...", "Redirecting...")}
    </div>
  )
}

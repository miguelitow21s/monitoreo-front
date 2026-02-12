"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { useAuth } from "@/hooks/useAuth"

export default function HomePage() {
  const router = useRouter()
  const { session, loading } = useAuth()

  useEffect(() => {
    if (loading) return
    router.replace(session ? "/dashboard" : "/auth/login")
  }, [loading, session, router])

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
      Redirigiendo...
    </div>
  )
}

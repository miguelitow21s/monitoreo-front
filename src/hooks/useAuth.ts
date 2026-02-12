"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/services/supabaseClient"
import type {
  Session,
  User,
  AuthChangeEvent,
} from "@supabase/supabase-js"
import { useRouter } from "next/navigation"

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    let mounted = true

    const loadSession = async () => {
      const {
        data,
        error,
      }: {
        data: { session: Session | null }
        error: Error | null
      } = await supabase.auth.getSession()

      if (!mounted) return

      if (error) {
        setSession(null)
        setUser(null)
      } else {
        setSession(data.session)
        setUser(data.session?.user ?? null)
      }

      setLoading(false)
    }

    loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        if (!mounted) return

        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const logout = async () => {
    await supabase.auth.signOut()
    router.replace("/auth/login")
  }

  return {
    session,
    user,
    loading,
    isAuthenticated: !!session,
    logout,
  }
}
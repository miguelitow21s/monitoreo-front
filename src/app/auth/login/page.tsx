"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { useAuth } from "@/hooks/useAuth"
import { getActiveLegalTermsVersion, LegalTermsVersion, recordCurrentUserLegalAcceptance } from "@/services/compliance.service"
import { supabase } from "@/services/supabaseClient"

export default function LoginPage() {
  const router = useRouter()
  const { session, loading } = useAuth()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [acceptedDataTreatment, setAcceptedDataTreatment] = useState(false)
  const [legalTerms, setLegalTerms] = useState<LegalTermsVersion | null>(null)
  const [loadingLegalTerms, setLoadingLegalTerms] = useState(true)
  const [showLegalContent, setShowLegalContent] = useState(false)

  useEffect(() => {
    if (!loading && session) {
      router.replace("/dashboard")
    }
  }, [session, loading, router])

  useEffect(() => {
    let mounted = true

    const loadLegalTerms = async () => {
      try {
        const activeTerms = await getActiveLegalTermsVersion()
        if (!mounted) return
        setLegalTerms(activeTerms)
      } catch {
        if (!mounted) return
        setLegalTerms(null)
      } finally {
        if (mounted) setLoadingLegalTerms(false)
      }
    }

    void loadLegalTerms()

    return () => {
      mounted = false
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!acceptedDataTreatment) {
      setError("You must accept personal data processing authorization.")
      return
    }

    if (!legalTerms) {
      setError("No active legal terms found. Contact support.")
      return
    }

    setSubmitting(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError("Invalid credentials")
      setSubmitting(false)
      return
    }

    try {
      await recordCurrentUserLegalAcceptance(legalTerms.id, window.navigator.userAgent)
    } catch {
      await supabase.auth.signOut()
      setError("Could not register legal acceptance. Please try again.")
      setSubmitting(false)
      return
    }

    router.replace("/dashboard")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Secure access
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">
          Enter your credentials to continue.
        </p>

        <div className="mt-6 space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="Email address"
            value={email}
            onChange={e => {
              setEmail(e.target.value)
              if (error) setError(null)
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
          />

          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={e => {
              setPassword(e.target.value)
              if (error) setError(null)
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
          />
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="flex items-start gap-2">
            <input
              id="accept-data-treatment"
              type="checkbox"
              checked={acceptedDataTreatment}
              onChange={e => {
                setAcceptedDataTreatment(e.target.checked)
                if (error) setError(null)
              }}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900"
            />
            <label htmlFor="accept-data-treatment" className="leading-5">
              I authorize personal data processing for operational control and legal audit purposes.
            </label>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              {loadingLegalTerms
                ? "Loading legal terms..."
                : legalTerms
                  ? `${legalTerms.title} (v${legalTerms.version})`
                  : "No active legal terms available."}
            </p>
            <button
              type="button"
              className="text-[11px] font-semibold text-slate-700 underline"
              onClick={() => setShowLegalContent(prev => !prev)}
              disabled={!legalTerms}
            >
              {showLegalContent ? "Hide terms" : "View terms"}
            </button>
          </div>

          {showLegalContent && legalTerms && (
            <div className="mt-2 max-h-40 overflow-auto rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600">
              {legalTerms.content}
            </div>
          )}
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

        <button
          type="submit"
          disabled={submitting || loading || loadingLegalTerms || !acceptedDataTreatment}
          className="mt-5 w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>

        <div className="mt-4 flex items-center justify-between text-xs">
          <Link href="/auth/forgot-password" className="text-slate-600 underline hover:text-slate-900">
            Forgot password
          </Link>
          <Link href="/auth/register" className="text-slate-600 underline hover:text-slate-900">
            Register
          </Link>
        </div>
      </form>
    </div>
  )
}

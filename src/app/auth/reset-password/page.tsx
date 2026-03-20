"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { useI18n } from "@/hooks/useI18n"
import { supabase } from "@/services/supabaseClient"

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const { t } = useI18n()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [checkingLink, setCheckingLink] = useState(true)
  const [sessionReady, setSessionReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const hydrateSessionFromLink = async () => {
      if (typeof window === "undefined") return
      setCheckingLink(true)
      setError(null)

      const url = new URL(window.location.href)
      const code = url.searchParams.get("code")
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""))
      const accessToken = hashParams.get("access_token")
      const refreshToken = hashParams.get("refresh_token")
      const hasAccessToken = !!accessToken && !!refreshToken

      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (sessionError) throw sessionError
        }

        const { data } = await supabase.auth.getSession()
        if (!mounted) return
        setSessionReady(!!data.session)

        if (data.session) {
          window.history.replaceState(null, document.title, "/auth/reset-password")
          setMessage(t("Enlace verificado. Puedes crear un nuevo PIN.", "Link verified. You can create a new PIN."))
        } else if (code || hasAccessToken) {
          setError(t("El enlace de recuperacion no es valido o expiro.", "Recovery link is invalid or expired."))
        }
      } catch (err: unknown) {
        if (!mounted) return
        setError(errorMessage(err, t("No se pudo validar el enlace de recuperacion.", "Could not validate recovery link.")))
      } finally {
        if (mounted) setCheckingLink(false)
      }
    }

    void hydrateSessionFromLink()
    return () => {
      mounted = false
    }
  }, [t])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (!sessionReady) {
      setError(t("Debes abrir el enlace de recuperacion enviado al correo.", "Please open the recovery link sent by email."))
      return
    }

    if (!/^\d{6}$/.test(password)) {
      setError(t("El PIN debe tener 6 digitos numericos.", "PIN must be 6 numeric digits."))
      return
    }

    if (password !== confirmPassword) {
      setError(t("Los PIN no coinciden.", "PINs do not match."))
      return
    }

    setSubmitting(true)

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      setMessage(t("PIN actualizado. Redirigiendo a inicio de sesion...", "PIN updated. Redirecting to sign in..."))
      setTimeout(() => router.replace("/auth/login"), 1200)
    } catch (err: unknown) {
      setError(errorMessage(err, t("No se pudo actualizar el PIN.", "Could not update PIN.")))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#667eea] to-[#764ba2] px-4">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute inset-0 bg-[radial-gradient(circle,_rgba(255,255,255,0.12)_1px,_transparent_1px)] bg-[length:56px_56px]" />
      </div>
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md rounded-[28px] border border-white/40 bg-white/95 p-7 shadow-2xl backdrop-blur"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {t("Seguridad de cuenta", "Account security")}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{t("Restablecer PIN", "Reset PIN")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t("Define un nuevo PIN de 6 digitos.", "Set a new 6-digit PIN.")}
        </p>

        {checkingLink && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {t("Validando enlace de recuperacion...", "Validating recovery link...")}
          </div>
        )}

        <div className="mt-6 space-y-3">
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]*"
              autoComplete="new-password"
              placeholder={t("Nuevo PIN (6 digitos)", "New PIN (6 digits)")}
              value={password}
              onChange={e => setPassword(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={checkingLink || !sessionReady}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-20 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />
            <button
              type="button"
              onClick={() => setShowPassword(prev => !prev)}
              disabled={checkingLink || !sessionReady}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {showPassword ? t("Ocultar", "Hide") : t("Ver", "Show")}
            </button>
          </div>
          <div className="relative">
            <input
              type={showConfirmPassword ? "text" : "password"}
              required
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]*"
              autoComplete="new-password"
              placeholder={t("Confirmar PIN", "Confirm PIN")}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={checkingLink || !sessionReady}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-20 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(prev => !prev)}
              disabled={checkingLink || !sessionReady}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {showConfirmPassword ? t("Ocultar", "Hide") : t("Ver", "Show")}
            </button>
          </div>
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        {message && <div className="mt-3 text-sm text-emerald-700">{message}</div>}

        <button
          type="submit"
          disabled={submitting || checkingLink || !sessionReady}
          className="mt-5 w-full rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-500 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {submitting ? t("Actualizando...", "Updating...") : t("Guardar PIN", "Save PIN")}
        </button>

        <div className="mt-4 text-right text-xs">
          <Link href="/auth/login" className="text-slate-600 underline hover:text-slate-900">
            {t("Volver al inicio de sesion", "Back to sign in")}
          </Link>
        </div>
      </form>
    </div>
  )
}

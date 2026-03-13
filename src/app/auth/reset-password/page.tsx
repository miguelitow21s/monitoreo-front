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
          setMessage(t("Enlace verificado. Puedes crear una nueva contrasena.", "Link verified. You can create a new password."))
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

    if (password.length < 8) {
      setError(t("La contrasena debe tener al menos 8 caracteres.", "Password must be at least 8 characters long."))
      return
    }

    if (password !== confirmPassword) {
      setError(t("Las contrasenas no coinciden.", "Passwords do not match."))
      return
    }

    setSubmitting(true)

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      setMessage(t("Contrasena actualizada. Redirigiendo a inicio de sesion...", "Password updated. Redirecting to sign in..."))
      setTimeout(() => router.replace("/auth/login"), 1200)
    } catch (err: unknown) {
      setError(errorMessage(err, t("No se pudo actualizar la contrasena.", "Could not update password.")))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {t("Seguridad de cuenta", "Account security")}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{t("Restablecer contrasena", "Reset password")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t("Define una nueva contrasena para tu cuenta.", "Set a new password for your account.")}
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
              minLength={8}
              autoComplete="new-password"
              placeholder={t("Nueva contrasena (min 8)", "New password (min 8)")}
              value={password}
              onChange={e => setPassword(e.target.value)}
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
              minLength={8}
              autoComplete="new-password"
              placeholder={t("Confirmar nueva contrasena", "Confirm new password")}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
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
          className="mt-5 w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
        >
          {submitting ? t("Actualizando...", "Updating...") : t("Guardar contrasena", "Save password")}
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

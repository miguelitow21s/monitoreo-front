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

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {visible ? <path d="M4 4l16 16" /> : null}
    </svg>
  )
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
    <div className="login-container">
      <form onSubmit={handleSubmit} className="login-box">
        <div className="logo">
          <div className="logo-icon">WT</div>
          <h1>WorkTrace</h1>
          <p>{t("Seguridad de cuenta", "Account security")}</p>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          {t("Define un nuevo PIN de 6 dígitos.", "Set a new 6-digit PIN.")}
        </p>

        {checkingLink && (
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {t("Validando enlace de recuperación...", "Validating recovery link...")}
          </div>
        )}

        <div className="form-group">
          <label>{t("Nuevo PIN (6 dígitos)", "New PIN (6 digits)")}</label>
          <div className="password-wrapper">
            <input
              type={showPassword ? "text" : "password"}
              required
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]*"
              autoComplete="new-password"
              placeholder="••••••"
              value={password}
              onChange={e => setPassword(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={checkingLink || !sessionReady}
              className="form-control has-password-toggle"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword(prev => !prev)}
              aria-label={showPassword ? t("Ocultar PIN", "Hide PIN") : t("Ver PIN", "Show PIN")}
            >
              <EyeIcon visible={showPassword} />
              {showPassword ? t("Ocultar", "Hide") : t("Ver", "Show")}
            </button>
          </div>
        </div>

        <div className="form-group">
          <label>{t("Confirmar PIN", "Confirm PIN")}</label>
          <div className="password-wrapper">
            <input
              type={showConfirmPassword ? "text" : "password"}
              required
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]*"
              autoComplete="new-password"
              placeholder="••••••"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={checkingLink || !sessionReady}
              className="form-control has-password-toggle"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowConfirmPassword(prev => !prev)}
              aria-label={showConfirmPassword ? t("Ocultar PIN", "Hide PIN") : t("Ver PIN", "Show PIN")}
            >
              <EyeIcon visible={showConfirmPassword} />
              {showConfirmPassword ? t("Ocultar", "Hide") : t("Ver", "Show")}
            </button>
          </div>
        </div>

        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
        {message && <div className="mb-3 text-sm text-emerald-700">{message}</div>}

        <button type="submit" disabled={submitting || checkingLink || !sessionReady} className="btn btn-primary">
          {submitting ? t("Actualizando...", "Updating...") : t("Guardar PIN", "Save PIN")}
        </button>

        <div className="forgot-password">
          <Link href="/auth/login">{t("Volver al inicio de sesión", "Back to sign in")}</Link>
        </div>
      </form>
    </div>
  )
}

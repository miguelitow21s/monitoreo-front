"use client"

import Link from "next/link"
import { useState } from "react"

import { useI18n } from "@/hooks/useI18n"
import { supabase } from "@/services/supabaseClient"

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default function ForgotPasswordPage() {
  const { t } = useI18n()
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setMessage(null)

    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/reset-password`
          : undefined

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      })

      if (resetError) throw resetError
      setMessage(t("Revisa tu correo para continuar el cambio de contrasena.", "Check your email to continue password reset."))
    } catch (err: unknown) {
      setError(errorMessage(err, t("No se pudo enviar el correo de recuperacion.", "Could not send recovery email.")))
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
          <p>{t("Recuperación de acceso", "Access recovery")}</p>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          {t("Te enviaremos un enlace para restablecer tu PIN.", "We will send you a reset link.")}
        </p>

        <div className="form-group">
          <label>{t("Correo Electrónico", "Email address")}</label>
          <div className="input-wrapper">
            <span className="input-icon">@</span>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder={t("correo@worktrace.com", "email@worktrace.com")}
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="form-control"
            />
          </div>
        </div>

        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
        {message && <div className="mb-3 text-sm text-emerald-700">{message}</div>}

        <button type="submit" disabled={submitting} className="btn btn-primary">
          {submitting ? t("Enviando...", "Sending...") : t("Enviar enlace", "Send link")}
        </button>

        <div className="forgot-password">
          <Link href="/auth/login">{t("Volver al inicio de sesión", "Back to sign in")}</Link>
        </div>
      </form>
    </div>
  )
}

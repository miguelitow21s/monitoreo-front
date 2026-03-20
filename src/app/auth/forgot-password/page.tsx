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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#667eea] to-[#764ba2] px-4">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute inset-0 bg-[radial-gradient(circle,_rgba(255,255,255,0.12)_1px,_transparent_1px)] bg-[length:56px_56px]" />
      </div>
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md rounded-[28px] border border-white/40 bg-white/95 p-7 shadow-2xl backdrop-blur"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {t("Recuperacion de acceso", "Access recovery")}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{t("Olvide mi PIN", "Forgot my PIN")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t("Te enviaremos un enlace para restablecerlo.", "We will send you a reset link.")}
        </p>

        <div className="mt-6 space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder={t("Correo electronico", "Email address")}
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
          />
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        {message && <div className="mt-3 text-sm text-emerald-700">{message}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-500 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {submitting ? t("Enviando...", "Sending...") : t("Enviar enlace", "Send link")}
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

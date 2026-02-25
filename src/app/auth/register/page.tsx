"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"

import { useI18n } from "@/hooks/useI18n"
import { supabase } from "@/services/supabaseClient"

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default function RegisterPage() {
  const router = useRouter()
  const { t } = useI18n()
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setMessage(null)

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            role: "empleado",
            full_name: fullName.trim() || null,
          },
        },
      })

      if (signUpError) throw signUpError

      const userId = data.user?.id
      const userEmail = data.user?.email ?? email

      if (userId) {
        const { error: registerError } = await supabase.rpc("register_employee", {
          p_user_id: userId,
          p_email: userEmail,
          p_full_name: fullName.trim() || null,
        })

        if (registerError) throw registerError
      }

      setMessage(
        t(
          "Registro exitoso. Si se requiere confirmacion por correo, valida tu email antes de iniciar sesion.",
          "Registration completed. If email confirmation is required, verify your email before signing in."
        )
      )
      setTimeout(() => router.replace("/auth/login"), 1400)
    } catch (err: unknown) {
      setError(errorMessage(err, t("No se pudo completar el registro.", "Could not complete registration.")))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form
        onSubmit={handleRegister}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {t("Registro de empleado", "Employee registration")}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{t("Crear cuenta", "Create account")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t(
            "La cuenta se crea con rol empleado. La activacion la controla administracion.",
            "The account is created with employee role. Activation is managed by administration."
          )}
        </p>

        <div className="mt-6 space-y-3">
          <input
            required
            placeholder={t("Nombre completo", "Full name")}
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
          />
          <input
            type="email"
            required
            autoComplete="email"
            placeholder={t("Correo electronico", "Email address")}
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
          />
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder={t("Contrasena (min 8)", "Password (min 8)")}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
          />
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        {message && <div className="mt-3 text-sm text-emerald-700">{message}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
        >
          {submitting ? t("Registrando...", "Creating account...") : t("Crear cuenta", "Create account")}
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

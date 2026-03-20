"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"

import { useI18n } from "@/hooks/useI18n"
import { supabase } from "@/services/supabaseClient"
import { normalizePhoneForOtp } from "@/utils/phone"

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function canDeferProfileBootstrap(error: unknown) {
  if (!error || typeof error !== "object") return false
  const rawMessage = "message" in error ? (error as { message?: unknown }).message : null
  const message = typeof rawMessage === "string" ? rawMessage.toLowerCase() : ""
  return (
    message.includes("no autenticado") ||
    message.includes("not authenticated") ||
    message.includes("jwt") ||
    message.includes("permission denied")
  )
}

export default function RegisterPage() {
  const router = useRouter()
  const { t } = useI18n()
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setMessage(null)

    try {
      const normalizedFirstName = firstName.trim()
      const normalizedLastName = lastName.trim()
      const fullName = `${normalizedFirstName} ${normalizedLastName}`.trim()

      if (!normalizedFirstName || !normalizedLastName) {
        throw new Error(
          t(
            "Debes ingresar nombre y apellido.",
            "First name and last name are required."
          )
        )
      }
      if (!phone.trim()) {
        throw new Error(
          t(
            "Debes ingresar numero de celular.",
            "Phone number is required."
          )
        )
      }
      const normalizedPhone = normalizePhoneForOtp(phone)
      if (!normalizedPhone) {
        throw new Error(
          t(
            "Ingresa un celular valido con codigo de pais. Ejemplo: +12025550123.",
            "Enter a valid phone number with country code. Example: +12025550123."
          )
        )
      }
      if (!/^\d{6}$/.test(password)) {
        throw new Error(
          t(
            "El PIN debe tener 6 digitos numericos.",
            "PIN must be 6 numeric digits."
          )
        )
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            role: "empleado",
            full_name: fullName,
            first_name: normalizedFirstName,
            last_name: normalizedLastName,
            phone_number: normalizedPhone,
          },
        },
      })

      if (signUpError) throw signUpError

      const userId = data.user?.id
      const userEmail = data.user?.email ?? email

      if (userId) {
        let { error: registerError } = await supabase.rpc("register_employee", {
          p_user_id: userId,
          p_email: userEmail,
          p_full_name: fullName,
          p_first_name: normalizedFirstName,
          p_last_name: normalizedLastName,
          p_phone_number: normalizedPhone,
        })

        // Backward compatibility while database migration is being applied.
        if (
          registerError &&
          typeof registerError.message === "string" &&
          registerError.message.toLowerCase().includes("does not exist")
        ) {
          const fallback = await supabase.rpc("register_employee", {
            p_user_id: userId,
            p_email: userEmail,
            p_full_name: fullName,
          })
          registerError = fallback.error
        }

        if (registerError && !canDeferProfileBootstrap(registerError)) throw registerError
      }

      setMessage(
        t(
          "Registro exitoso. Si se requiere confirmacion por correo, valida tu email antes de iniciar sesion. El perfil se completara al primer acceso.",
          "Registration completed. If email confirmation is required, verify your email before signing in. Profile bootstrap will complete on first access."
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#667eea] to-[#764ba2] px-4">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute inset-0 bg-[radial-gradient(circle,_rgba(255,255,255,0.12)_1px,_transparent_1px)] bg-[length:56px_56px]" />
      </div>
      <form
        onSubmit={handleRegister}
        className="relative w-full max-w-md rounded-[28px] border border-white/40 bg-white/95 p-7 shadow-2xl backdrop-blur"
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
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              required
              placeholder={t("Nombre", "First name")}
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />
            <input
              required
              placeholder={t("Apellido", "Last name")}
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />
          </div>
          <input
            type="tel"
            required
            autoComplete="tel"
            placeholder={t("Celular (+codigo de pais)", "Phone (+country code)")}
            value={phone}
            onChange={e => setPhone(e.target.value)}
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
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]*"
              autoComplete="new-password"
              placeholder={t("PIN (6 digitos)", "PIN (6 digits)")}
              value={password}
              onChange={e => setPassword(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-11 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />
            <button
              type="button"
              onClick={() => setShowPassword(prev => !prev)}
              aria-label={showPassword ? t("Ocultar PIN", "Hide PIN") : t("Mostrar PIN", "Show PIN")}
              title={showPassword ? t("Ocultar PIN", "Hide PIN") : t("Mostrar PIN", "Show PIN")}
              className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100"
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  <path d="M3 3l18 18" />
                  <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                  <path d="M9.4 5.2A10.7 10.7 0 0 1 12 5c5 0 8.7 3.1 10 7-0.5 1.4-1.3 2.6-2.4 3.7" />
                  <path d="M6.2 6.2C4.3 7.5 2.9 9.4 2 12c1.3 3.9 5 7 10 7 1.9 0 3.6-0.5 5-1.3" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        {message && <div className="mt-3 text-sm text-emerald-700">{message}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-500 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
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

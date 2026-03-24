"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"

import { useI18n } from "@/hooks/useI18n"
import { supabase } from "@/services/supabaseClient"
import { invokeEdge } from "@/services/edgeClient"
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

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {visible ? <path d="M4 4l16 16" /> : null}
    </svg>
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
        try {
          await invokeEdge("auth_register", {
            idempotencyKey: crypto.randomUUID(),
            body: {
              action: "register_employee",
              p_user_id: userId,
              p_email: userEmail,
              p_full_name: fullName,
              p_first_name: normalizedFirstName,
              p_last_name: normalizedLastName,
              p_phone_number: normalizedPhone,
            },
          })
        } catch (registerError: unknown) {
          if (!canDeferProfileBootstrap(registerError)) throw registerError
        }
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
    <div className="login-container">
      <form onSubmit={handleRegister} className="login-box">
        <div className="logo">
          <div className="logo-icon">WT</div>
          <h1>WorkTrace</h1>
          <p>{t("Registro de empleado", "Employee registration")}</p>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          {t(
            "La cuenta se crea con rol empleado. La activación la controla administración.",
            "The account is created with employee role. Activation is managed by administration."
          )}
        </p>

        <div className="form-row two-col">
          <div className="form-group">
            <label>{t("Nombre", "First name")}</label>
            <input
              required
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              className="form-control"
              placeholder={t("Nombre", "First name")}
            />
          </div>
          <div className="form-group">
            <label>{t("Apellido", "Last name")}</label>
            <input
              required
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              className="form-control"
              placeholder={t("Apellido", "Last name")}
            />
          </div>
        </div>

        <div className="form-group">
          <label>{t("Teléfono", "Phone")}</label>
          <input
            type="tel"
            required
            autoComplete="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="form-control"
            placeholder={t("Celular +código país", "Phone +country code")}
          />
        </div>

        <div className="form-group">
          <label>{t("Correo Electrónico", "Email")}</label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="form-control"
            placeholder={t("correo@worktrace.com", "email@worktrace.com")}
          />
        </div>

        <div className="form-group">
          <label>{t("PIN numérico (6 dígitos)", "Numeric PIN (6 digits)")}</label>
          <div className="password-wrapper">
            <input
              type={showPassword ? "text" : "password"}
              required
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]*"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="form-control has-password-toggle"
              placeholder="••••••"
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

        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
        {message && <div className="mb-3 text-sm text-emerald-700">{message}</div>}

        <button type="submit" disabled={submitting} className="btn btn-primary">
          {submitting ? t("Registrando...", "Creating account...") : t("Crear cuenta", "Create account")}
        </button>

        <div className="forgot-password">
          <Link href="/auth/login">{t("Volver al inicio de sesión", "Back to sign in")}</Link>
        </div>
      </form>
    </div>
  )
}

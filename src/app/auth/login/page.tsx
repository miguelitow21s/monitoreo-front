"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Manrope } from "next/font/google"

import LanguageSwitch from "@/components/LanguageSwitch"
import { useLanguage } from "@/context/LanguageContext"
import { useAuth } from "@/hooks/useAuth"
import { acceptLegalConsent, getLegalConsentStatus } from "@/services/compliance.service"
import { supabase } from "@/services/supabaseClient"

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
})

function BroomIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="36" height="36" aria-hidden="true">
      <path d="M6 3l15 15" />
      <path d="M4 18l4-4 2 2-4 4H4v-2z" />
      <path d="M14 6l4-4" />
    </svg>
  )
}

function EnvelopeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" ry="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

function SignInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const { session, loading } = useAuth()
  const { language } = useLanguage()

  const t = (es: string, en: string) => (language === "en" ? en : es)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [acceptedDataTreatment, setAcceptedDataTreatment] = useState(false)
  const [loadingLegalStatus, setLoadingLegalStatus] = useState(false)
  const [blockAutoRedirect, setBlockAutoRedirect] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [savingPassword, setSavingPassword] = useState(false)

  const extractErrorMessage = (rawError: unknown) => {
    if (rawError instanceof Error && rawError.message) return rawError.message
    if (typeof rawError === "object" && rawError !== null && "message" in rawError) {
      const message = (rawError as { message?: unknown }).message
      if (typeof message === "string" && message.trim().length > 0) return message
    }
    return t(
      "No se pudo validar el consentimiento legal. Intenta nuevamente.",
      "Could not validate legal consent. Please try again."
    )
  }

  useEffect(() => {
    if (!loading && session && !blockAutoRedirect) {
      router.replace("/dashboard")
    }
  }, [session, loading, router, blockAutoRedirect])

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setPasswordError(null)

    if (!acceptedDataTreatment) {
      setError(
        t(
          "Debes aceptar la autorizacion de tratamiento de datos personales.",
          "You must accept personal data processing authorization."
        )
      )
      return
    }

    setSubmitting(true)
    setBlockAutoRedirect(true)

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        setError(t("Credenciales invalidas", "Invalid credentials"))
        setBlockAutoRedirect(false)
        return
      }

      const freshSession = data.session ?? (await supabase.auth.getSession()).data.session
      const accessToken = freshSession?.access_token ?? null
      if (!accessToken) {
        await supabase.auth.signOut()
        setError(
          t(
            "No se pudo establecer sesion autenticada. Inicia sesion de nuevo.",
            "Authenticated session was not established. Sign in again."
          )
        )
        setBlockAutoRedirect(false)
        return
      }

      setLoadingLegalStatus(true)
      const status = await getLegalConsentStatus(accessToken)

      if (!status.accepted) {
        if (!status.active_term?.id) {
          throw new Error(
            t(
              "No se encontro termino legal activo para aceptar.",
              "No active legal term was found to accept."
            )
          )
        }
        await acceptLegalConsent(status.active_term.id, accessToken)
      }

      const metadata = {
        ...((data.user?.user_metadata as Record<string, unknown> | null) ?? {}),
        ...((data.user?.app_metadata as Record<string, unknown> | null) ?? {}),
      }
      const mustChangePassword =
        metadata.mustChangePassword === true ||
        metadata.must_change_password === true ||
        metadata.requirePasswordChange === true ||
        metadata.require_password_change === true

      if (mustChangePassword) {
        setShowPasswordModal(true)
        setLoadingLegalStatus(false)
        return
      }

      setLoadingLegalStatus(false)
      setBlockAutoRedirect(false)
      router.replace("/dashboard")
    } catch (legalError: unknown) {
      await supabase.auth.signOut()
      const status =
        typeof legalError === "object" && legalError !== null && "status" in legalError
          ? (legalError as { status?: unknown }).status
          : undefined
      const requestId =
        typeof legalError === "object" && legalError !== null && "request_id" in legalError
          ? (legalError as { request_id?: unknown }).request_id
          : undefined
      const sbRequestId =
        typeof legalError === "object" && legalError !== null && "sb_request_id" in legalError
          ? (legalError as { sb_request_id?: unknown }).sb_request_id
          : undefined
      const xRequestId =
        typeof legalError === "object" && legalError !== null && "x_request_id" in legalError
          ? (legalError as { x_request_id?: unknown }).x_request_id
          : undefined
      const responseBody =
        typeof legalError === "object" && legalError !== null && "response_body" in legalError
          ? (legalError as { response_body?: unknown }).response_body
          : undefined
      const timestampUtc =
        typeof legalError === "object" && legalError !== null && "timestamp_utc" in legalError
          ? (legalError as { timestamp_utc?: unknown }).timestamp_utc
          : undefined

      const baseMessage = extractErrorMessage(legalError)
      const tags: string[] = []
      if (typeof requestId === "string" && requestId.trim().length > 0) tags.push(`request_id: ${requestId}`)
      if (typeof sbRequestId === "string" && sbRequestId.trim().length > 0) tags.push(`sb-request-id: ${sbRequestId}`)
      if (typeof xRequestId === "string" && xRequestId.trim().length > 0) tags.push(`x-request-id: ${xRequestId}`)
      if (typeof timestampUtc === "string" && timestampUtc.trim().length > 0) tags.push(`utc: ${timestampUtc}`)
      if (typeof status === "number") tags.push(`status: ${status}`)

      const message = tags.length > 0 ? `${baseMessage} (${tags.join(" | ")})` : baseMessage

      console.error("legal_consent_failed", {
        status,
        request_id: requestId,
        sb_request_id: sbRequestId,
        x_request_id: xRequestId,
        timestamp_utc: timestampUtc,
        response_body: responseBody,
      })

      setError(message)
      setLoadingLegalStatus(false)
      setBlockAutoRedirect(false)
      return
    } finally {
      setSubmitting(false)
    }
  }

  const closePasswordModal = async () => {
    setShowPasswordModal(false)
    setNewPassword("")
    setConfirmPassword("")
    setPasswordError(null)
    await supabase.auth.signOut()
    setBlockAutoRedirect(false)
  }

  const handlePasswordChange = async () => {
    setPasswordError(null)

    if (!/^\d{6,}$/.test(newPassword)) {
      setPasswordError(
        t(
          "La nueva contraseña debe tener mínimo 6 dígitos numéricos.",
          "New password must contain at least 6 numeric digits."
        )
      )
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(t("Las contraseñas no coinciden.", "Passwords do not match."))
      return
    }

    setSavingPassword(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError
      setShowPasswordModal(false)
      setNewPassword("")
      setConfirmPassword("")
      setBlockAutoRedirect(false)
      router.replace("/dashboard")
    } catch (passwordUpdateError: unknown) {
      setPasswordError(extractErrorMessage(passwordUpdateError))
    } finally {
      setSavingPassword(false)
    }
  }

  if (loading || (!blockAutoRedirect && session)) {
    return (
      <div className={`login-container ${manrope.className}`}>
        <div className="login-box">
          <div className="logo">
            <div className="logo-icon">WT</div>
            <h1>WorkTrace</h1>
            <p>{t("Gestión Profesional de Limpieza", "Professional cleaning management")}</p>
          </div>
          <p className="text-center text-sm text-slate-600">{t("Validando sesión...", "Validating session...")}</p>
        </div>
      </div>
    )
  }

  return (
    <div id="loginScreen" className={`login-container ${manrope.className}`}>
      <div className="login-box">
        <div className="flex justify-end">
          <LanguageSwitch compact />
        </div>
        <div className="logo">
          <div className="logo-icon">
            <BroomIcon />
          </div>
          <h1>WorkTrace</h1>
          <p>{t("Gestión Profesional de Limpieza", "Professional cleaning management")}</p>
        </div>

        <div className="consent-box">
          <label>
            <input
              id="consentCheck"
              type="checkbox"
              checked={acceptedDataTreatment}
              onChange={e => {
                setAcceptedDataTreatment(e.target.checked)
                if (error) setError(null)
              }}
            />
            <span>
              {t(
                "Autorizo el uso de mis datos personales, ubicación GPS y cámara para fines de verificación de turnos laborales. Acepto los términos y condiciones del servicio.",
                "I authorize the use of my personal data, GPS location, and camera for shift verification. I accept the service terms and conditions."
              )}
            </span>
          </label>
        </div>

        <form id="loginForm" onSubmit={handleLogin}>
          <div className="form-group">
            <label>{t("Correo Electrónico", "Email")}</label>
            <div className="input-wrapper">
              <span className="input-icon">
                <EnvelopeIcon />
              </span>
              <input
                id="loginEmail"
                type="email"
                className="form-control"
                placeholder={t("usuario@worktrace.com", "user@worktrace.com")}
                required
                autoComplete="username"
                value={email}
                onChange={e => {
                  setEmail(e.target.value)
                  if (error) setError(null)
                }}
              />
            </div>
          </div>

          <div className="form-group">
            <label>{t("Contraseña Numérica", "Numeric password")}</label>
            <div className="input-wrapper">
              <span className="input-icon">
                <LockIcon />
              </span>
              <input
                id="loginPassword"
                type="password"
                className="form-control"
                placeholder="••••••"
                pattern="[0-9]*"
                inputMode="numeric"
                maxLength={6}
                required
                autoComplete="current-password"
                value={password}
                onChange={e => {
                  setPassword(e.target.value.replace(/\D/g, "").slice(0, 6))
                  if (error) setError(null)
                }}
              />
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || loading || loadingLegalStatus || !acceptedDataTreatment}
          >
            <SignInIcon />
            {submitting || loadingLegalStatus
              ? t("Ingresando...", "Signing in...")
              : t("Iniciar Sesión", "Sign in")}
          </button>
        </form>

        <div className="forgot-password">
          <Link href="/auth/forgot-password">{t("¿Olvidé mi contraseña?", "Forgot password?")}</Link>
        </div>
      </div>

      {showPasswordModal && (
        <div id="passwordModal" className="modal active login-password-modal">
          <div className="modal-content">
            <div className="modal-header">
              <h3>{t("Cambiar Contraseña", "Change password")}</h3>
              <button className="btn-close" type="button" onClick={() => void closePasswordModal()}>
                <CloseIcon />
              </button>
            </div>

            <div className="modal-body">
              <div className="alert alert-warning">
                <span>
                  <WarningIcon />
                </span>
                <span>
                  {t(
                    "Por seguridad, debe cambiar su contraseña temporal en el primer ingreso.",
                    "For security, you must change your temporary password on first sign in."
                  )}
                </span>
              </div>

              <div className="form-group">
                <label>{t("Nueva Contraseña Numérica", "New numeric password")}</label>
                <input
                  id="newPassword"
                  type="password"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  placeholder={t("Mínimo 6 dígitos", "Minimum 6 digits")}
                  value={newPassword}
                  onChange={event => setNewPassword(event.target.value.replace(/\D/g, "").slice(0, 12))}
                />
              </div>

              <div className="form-group">
                <label>{t("Confirmar Contraseña", "Confirm password")}</label>
                <input
                  id="confirmPassword"
                  type="password"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  placeholder={t("Repita la contraseña", "Repeat password")}
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value.replace(/\D/g, "").slice(0, 12))}
                />
              </div>

              {passwordError && <div className="alert alert-error">{passwordError}</div>}
            </div>

            <div className="modal-footer">
              <button className="btn btn-primary" type="button" onClick={() => void handlePasswordChange()} disabled={savingPassword}>
                {savingPassword ? t("Guardando...", "Saving...") : t("Guardar Contraseña", "Save password")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Manrope } from "next/font/google"

import LanguageSwitch from "@/components/LanguageSwitch"
import { useLanguage } from "@/context/LanguageContext"
import { useAuth } from "@/hooks/useAuth"
import { acceptLegalConsent, getLegalConsentStatus, LegalConsentStatus } from "@/services/compliance.service"
import { supabase } from "@/services/supabaseClient"

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
})

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
  const [legalStatus, setLegalStatus] = useState<LegalConsentStatus | null>(null)
  const [loadingLegalStatus, setLoadingLegalStatus] = useState(false)
  const [needsBackendConsent, setNeedsBackendConsent] = useState(false)
  const [processingBackendConsent, setProcessingBackendConsent] = useState(false)
  const [pendingAccessToken, setPendingAccessToken] = useState<string | null>(null)
  const [blockAutoRedirect, setBlockAutoRedirect] = useState(false)

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
    setNeedsBackendConsent(false)
    setPendingAccessToken(null)

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

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(t("Credenciales invalidas", "Invalid credentials"))
      setSubmitting(false)
      setBlockAutoRedirect(false)
      return
    }

    let accessToken: string | null = data.session?.access_token ?? null
    if (!accessToken) {
      const sessionResult = await supabase.auth.getSession()
      accessToken = sessionResult.data.session?.access_token ?? null
    }

    if (!accessToken) {
      await supabase.auth.signOut()
      setError(
        t(
          "No se pudo establecer sesion autenticada. Inicia sesion de nuevo.",
          "Authenticated session was not established. Sign in again."
        )
      )
      setSubmitting(false)
      setBlockAutoRedirect(false)
      return
    }

    try {
      setLoadingLegalStatus(true)
      const status = await getLegalConsentStatus(accessToken)
      setLegalStatus(status)

      if (!status.accepted) {
        setNeedsBackendConsent(true)
        setPendingAccessToken(accessToken)
        setError(
          t(
            "Debes leer y aceptar los terminos y condiciones para continuar.",
            "You must read and accept terms and conditions to continue."
          )
        )
        setSubmitting(false)
        setLoadingLegalStatus(false)
        return
      }
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
      setSubmitting(false)
      setLoadingLegalStatus(false)
      setBlockAutoRedirect(false)
      return
    }

    setLoadingLegalStatus(false)
    setBlockAutoRedirect(false)
    router.replace("/dashboard")
  }

  const handleAcceptBackendConsent = async () => {
    if (!legalStatus?.active_term) {
      setError(
        t(
          "No se encontro termino legal activo para aceptar.",
          "No active legal term was found to accept."
        )
      )
      return
    }

    setError(null)
    setProcessingBackendConsent(true)
    try {
      await acceptLegalConsent(legalStatus.active_term.id, pendingAccessToken ?? undefined)
      setNeedsBackendConsent(false)
      setPendingAccessToken(null)
      setBlockAutoRedirect(false)
      router.replace("/dashboard")
    } catch (legalError: unknown) {
      setError(extractErrorMessage(legalError))
    } finally {
      setProcessingBackendConsent(false)
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
    <div className={`login-container ${manrope.className}`}>
      <form onSubmit={handleLogin} className="login-box">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {t("Acceso seguro", "Secure access")}
          </span>
          <LanguageSwitch />
        </div>

        <div className="logo">
          <div className="logo-icon">WT</div>
          <h1>WorkTrace</h1>
          <p>{t("Gestión Profesional de Limpieza", "Professional cleaning management")}</p>
        </div>

        <div className="consent-box">
          <label>
            <input
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
          {needsBackendConsent && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
              {t(
                "Tienes sesión iniciada, pero falta aceptar los términos activos en backend.",
                "Session is active, but backend legal terms still need your acceptance."
              )}
            </div>
          )}
        </div>

        <div className="form-group">
          <label>{t("Correo Electrónico", "Email")}</label>
          <div className="input-wrapper">
            <span className="input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <rect x="3" y="5" width="18" height="14" rx="2" ry="2" />
                <path d="M3 7l9 6 9-6" />
              </svg>
            </span>
            <input
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
          <label>{t("Contraseña Numérica", "Numeric PIN")}</label>
          <div className="input-wrapper">
            <span className="input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <rect x="4" y="11" width="16" height="9" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </span>
            <input
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

        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={
            submitting ||
            loading ||
            loadingLegalStatus ||
            !acceptedDataTreatment ||
            processingBackendConsent ||
            needsBackendConsent
          }
        >
          {submitting ? t("Ingresando...", "Signing in...") : t("Iniciar Sesión", "Sign in")}
        </button>

        {needsBackendConsent && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleAcceptBackendConsent()}
            disabled={processingBackendConsent}
          >
            {processingBackendConsent
              ? t("Aceptando términos...", "Accepting terms...")
              : t("Aceptar términos y continuar", "Accept terms and continue")}
          </button>
        )}

        <div className="forgot-password">
          <Link href="/auth/forgot-password">{t("¿Olvidé mi contraseña?", "Forgot password?")}</Link>
        </div>

        <div className="test-users">
          <h4>{t("Usuarios de Prueba", "Test Users")}</h4>
          <div className="mt-2 flex flex-col gap-2">
            <div>
              <code>empleado@worktrace.com</code> - {t("Clave", "PIN")}: <code>123456</code> ({t("Empleado", "Employee")})
            </div>
            <div>
              <code>supervisor@worktrace.com</code> - {t("Clave", "PIN")}: <code>123456</code> ({t("Supervisor", "Supervisor")})
            </div>
            <div>
              <code>super@worktrace.com</code> - {t("Clave", "PIN")}: <code>123456</code> ({t("Superusuario", "Superuser")})
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

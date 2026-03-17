"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import LanguageSwitch from "@/components/LanguageSwitch"
import { useLanguage } from "@/context/LanguageContext"
import { useAuth } from "@/hooks/useAuth"
import { acceptLegalConsent, getLegalConsentStatus, LegalConsentStatus } from "@/services/compliance.service"
import { supabase } from "@/services/supabaseClient"

export default function LoginPage() {
  const router = useRouter()
  const { session, loading } = useAuth()
  const { language } = useLanguage()

  const t = (es: string, en: string) => (language === "en" ? en : es)

  const [email, setEmail] = useState("")
  const [pin, setPin] = useState("")
  const [showPassword, setShowPassword] = useState(false)
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

    const normalizedPin = pin.trim()
    if (!/^\d{6}$/.test(normalizedPin)) {
      setError(t("El PIN debe tener 6 digitos.", "PIN must be 6 digits."))
      return
    }

    setSubmitting(true)
    setBlockAutoRedirect(true)

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: normalizedPin,
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
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <p className="text-sm text-slate-600">
            {t("Validando sesion...", "Validating session...")}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-100 px-3 pb-6 pt-6 sm:items-center sm:px-4">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-7"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t("Acceso seguro", "Secure access")}
          </p>
          <LanguageSwitch />
        </div>

        <h1 className="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">{t("Iniciar sesion", "Sign in")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t("Ingresa tus credenciales para continuar.", "Enter your credentials to continue.")}
        </p>

        <div className="mt-6 space-y-3">
          <input
            type="text"
            required
            autoComplete="username"
            placeholder={t("Correo o usuario", "Email or username")}
            value={email}
            onChange={e => {
              setEmail(e.target.value)
              if (error) setError(null)
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 caret-slate-900 outline-none transition focus:border-slate-800"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {t("PIN de 6 digitos", "6-digit PIN")}
            </span>
          </div>

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              autoComplete="one-time-code"
              placeholder={t("PIN de 6 digitos", "6-digit PIN")}
              inputMode="numeric"
              pattern="\\d*"
              maxLength={6}
              value={pin}
              onChange={e => {
                const next = e.target.value.replace(/\D/g, "").slice(0, 6)
                setPin(next)
                if (error) setError(null)
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-11 text-sm text-slate-800 caret-slate-900 outline-none transition focus:border-slate-800"
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

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 sm:p-3">
          <div className="flex items-start gap-2">
            <input
              id="accept-data-treatment"
              type="checkbox"
              checked={acceptedDataTreatment}
              onChange={e => {
                setAcceptedDataTreatment(e.target.checked)
                if (error) setError(null)
              }}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900"
            />
            <label htmlFor="accept-data-treatment" className="leading-5 break-words text-[11px] sm:text-xs">
              {t(
                "Autorizo el tratamiento de mis datos personales para control operativo y fines de auditoria legal.",
                "I authorize personal data processing for operational control and legal audit purposes."
              )}
            </label>
          </div>

          {needsBackendConsent && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
              {t(
                "Tienes sesion iniciada, pero falta aceptar los terminos activos en backend.",
                "Session is active, but backend legal terms still need your acceptance."
              )}
            </div>
          )}
        </div>

        {error && <div className="mt-3 break-words text-sm text-red-600">{error}</div>}

        <button
          type="submit"
          disabled={
            submitting ||
            loading ||
            loadingLegalStatus ||
            !acceptedDataTreatment ||
            processingBackendConsent ||
            needsBackendConsent
          }
          className="mt-5 w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
        >
          {submitting ? t("Ingresando...", "Signing in...") : t("Ingresar", "Sign in")}
        </button>

        {needsBackendConsent && (
          <button
            type="button"
            onClick={() => void handleAcceptBackendConsent()}
            disabled={processingBackendConsent}
            className="mt-3 w-full rounded-lg border border-slate-300 bg-white py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 disabled:opacity-60"
          >
            {processingBackendConsent
              ? t("Aceptando terminos...", "Accepting terms...")
              : t("Aceptar terminos y continuar", "Accept terms and continue")}
          </button>
        )}

        <div className="mt-4 flex items-center justify-between text-xs">
          <Link href="/auth/forgot-password" className="text-slate-600 underline hover:text-slate-900">
            {t("Olvide mi contrasena", "Forgot password")}
          </Link>
        </div>
      </form>
    </div>
  )
}

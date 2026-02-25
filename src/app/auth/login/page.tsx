"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { useAuth } from "@/hooks/useAuth"
import { acceptLegalConsent, getLegalConsentStatus, LegalConsentStatus } from "@/services/compliance.service"
import { supabase } from "@/services/supabaseClient"

export default function LoginPage() {
  const router = useRouter()
  const { session, loading } = useAuth()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [acceptedDataTreatment, setAcceptedDataTreatment] = useState(false)
  const [legalStatus, setLegalStatus] = useState<LegalConsentStatus | null>(null)
  const [loadingLegalStatus, setLoadingLegalStatus] = useState(false)
  const [showLegalContent, setShowLegalContent] = useState(false)
  const [needsBackendConsent, setNeedsBackendConsent] = useState(false)
  const [processingBackendConsent, setProcessingBackendConsent] = useState(false)
  const [pendingAccessToken, setPendingAccessToken] = useState<string | null>(null)
  const [blockAutoRedirect, setBlockAutoRedirect] = useState(false)

  const extractErrorMessage = (error: unknown) => {
    if (error instanceof Error && error.message) return error.message
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = (error as { message?: unknown }).message
      if (typeof message === "string" && message.trim().length > 0) return message
    }
    return "No se pudo validar el consentimiento legal. Intenta nuevamente."
  }

  useEffect(() => {
    if (!loading && session && !blockAutoRedirect) {
      router.replace("/dashboard")
    }
  }, [session, loading, router, blockAutoRedirect])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setNeedsBackendConsent(false)
    setPendingAccessToken(null)

    if (!acceptedDataTreatment) {
      setError("Debes aceptar la autorizacion de tratamiento de datos personales.")
      return
    }

    setSubmitting(true)
    setBlockAutoRedirect(true)

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError("Credenciales invalidas")
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
      setError("No se pudo establecer sesion autenticada. Inicia sesion de nuevo.")
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
        setShowLegalContent(true)
        setError("Debes leer y aceptar los terminos y condiciones para continuar.")
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
      setError("No se encontro termino legal activo para aceptar.")
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Acceso seguro
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Iniciar sesion</h1>
        <p className="mt-2 text-sm text-slate-600">
          Ingresa tus credenciales para continuar.
        </p>

        <div className="mt-6 space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="Correo electronico"
            value={email}
            onChange={e => {
              setEmail(e.target.value)
              if (error) setError(null)
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
          />

          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Contrasena"
            value={password}
            onChange={e => {
              setPassword(e.target.value)
              if (error) setError(null)
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
          />
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
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
            <label htmlFor="accept-data-treatment" className="leading-5">
              Autorizo el tratamiento de mis datos personales para control operativo y fines de auditoria legal.
            </label>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              {loadingLegalStatus
                ? "Cargando terminos legales..."
                : legalStatus?.active_term
                  ? `${legalStatus.active_term.title ?? "Terminos legales activos"} (v${legalStatus.active_term.version ?? "-"})`
                  : "Los terminos legales se validaran despues del inicio de sesion."}
            </p>
            <button
              type="button"
              className="text-[11px] font-semibold text-slate-700 underline"
              onClick={() => setShowLegalContent(prev => !prev)}
              disabled={!legalStatus?.active_term}
            >
              {showLegalContent ? "Ocultar terminos" : "Ver terminos"}
            </button>
          </div>

          {showLegalContent && legalStatus?.active_term && (
            <div className="mt-2 max-h-64 space-y-2 overflow-auto rounded border border-slate-200 bg-white p-3 text-[11px] text-slate-600">
              <p>
                <span className="font-semibold">Codigo:</span> {legalStatus.active_term.code ?? "-"} |{" "}
                <span className="font-semibold">Titulo:</span> {legalStatus.active_term.title ?? "-"} |{" "}
                <span className="font-semibold">Version:</span> {legalStatus.active_term.version ?? "-"}
              </p>
              <div className="whitespace-pre-wrap break-words rounded border border-slate-100 bg-slate-50 p-2 text-[11px] leading-5 text-slate-700">
                {legalStatus.active_term.content?.trim() || "El contenido del documento legal no fue enviado por backend."}
              </div>
            </div>
          )}

          {needsBackendConsent && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
              Tienes sesion iniciada, pero falta aceptar los terminos activos en backend.
            </div>
          )}
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

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
          {submitting ? "Ingresando..." : "Ingresar"}
        </button>

        {needsBackendConsent && (
          <button
            type="button"
            onClick={() => void handleAcceptBackendConsent()}
            disabled={processingBackendConsent}
            className="mt-3 w-full rounded-lg border border-slate-300 bg-white py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 disabled:opacity-60"
          >
            {processingBackendConsent ? "Aceptando terminos..." : "Aceptar terminos y continuar"}
          </button>
        )}

        <div className="mt-4 flex items-center justify-between text-xs">
          <Link href="/auth/forgot-password" className="text-slate-600 underline hover:text-slate-900">
            Olvide mi contrasena
          </Link>
          <Link href="/auth/register" className="text-slate-600 underline hover:text-slate-900">
            Registrarme
          </Link>
        </div>
      </form>
    </div>
  )
}

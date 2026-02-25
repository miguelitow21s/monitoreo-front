import { supabase } from "@/services/supabaseClient"

export interface LegalConsentStatus {
  accepted: boolean
  accepted_at: string | null
  active_term: {
    id?: number
    code?: string
    title?: string
    version?: string
    content?: string | null
  } | null
}

function shouldFallbackToDirectTableAccess(error: unknown) {
  if (typeof error !== "object" || error === null) return false

  const status = (error as { status?: unknown }).status
  if (typeof status === "number" && status >= 400) return false

  const message =
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message.toLowerCase()
      : ""

  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("cors") ||
    message.includes("fetch")
  )
}

function getErrorStatus(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === "number" ? status : undefined
}

function toStatusError(
  message: string,
  status?: number,
  requestId?: string,
  sbRequestId?: string,
  xRequestId?: string,
  responseBody?: string
) {
  const error = new Error(message) as Error & {
    status?: number
    request_id?: string
    sb_request_id?: string
    x_request_id?: string
    response_body?: string
    timestamp_utc?: string
  }
  if (typeof status === "number") error.status = status
  if (requestId) error.request_id = requestId
  if (sbRequestId) error.sb_request_id = sbRequestId
  if (xRequestId) error.x_request_id = xRequestId
  if (responseBody) error.response_body = responseBody
  error.timestamp_utc = new Date().toISOString()
  return error
}

function sleep(ms: number) {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms))
}

function computeBackoffMs(attempt: number) {
  const base = Math.min(3000, 500 * 2 ** attempt)
  const jitter = Math.floor(Math.random() * 250)
  return base + jitter
}

async function getLatestAccessToken() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session?.access_token ?? null
}

async function refreshAndGetAccessToken() {
  await supabase.auth.refreshSession()
  return getLatestAccessToken()
}

async function invokeLegalConsentDirect<T>(
  body: Record<string, unknown>,
  accessToken: string,
  idempotencyKey?: string
) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!baseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL no esta configurada.")
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY no esta configurada.")

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    apikey: anonKey,
    "Content-Type": "application/json",
  }

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey
  }

  const response = await fetch(`${baseUrl}/functions/v1/legal_consent`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  const rawBody = await response.text()
  let payload: {
    success?: boolean
    data?: T | null
    error?: { message?: string; request_id?: string } | null
    request_id?: string
  } | null = null

  try {
    payload = rawBody
      ? (JSON.parse(rawBody) as {
          success?: boolean
          data?: T | null
          error?: { message?: string; request_id?: string } | null
          request_id?: string
        })
      : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const xRequestId = response.headers.get("x-request-id") ?? undefined
    const sbRequestId = response.headers.get("sb-request-id") ?? undefined
    const requestId = payload?.request_id ?? payload?.error?.request_id ?? response.headers.get("x-request-id") ?? undefined
    const fallbackBodyMessage = rawBody?.trim().slice(0, 600)
    const message = payload?.error?.message ?? fallbackBodyMessage ?? `Fallo legal_consent (HTTP ${response.status})`
    throw toStatusError(message, response.status, requestId, sbRequestId, xRequestId, rawBody?.trim() || undefined)
  }

  if (payload && "success" in payload && payload.success === false) {
    const requestId = payload.request_id ?? payload.error?.request_id
    const xRequestId = response.headers.get("x-request-id") ?? undefined
    const sbRequestId = response.headers.get("sb-request-id") ?? undefined
    const message = payload.error?.message ?? "legal_consent fue rechazado por backend."
    throw toStatusError(message, undefined, requestId, sbRequestId, xRequestId, rawBody?.trim() || undefined)
  }

  return (payload?.data ?? null) as T
}

async function invokeLegalConsentWithRetry<T>(
  body: Record<string, unknown>,
  accessToken?: string,
  idempotencyKey?: string
) {
  let token = accessToken ?? (await getLatestAccessToken())
  if (!token) {
    throw toStatusError("Token de sesion autenticada no disponible.", 401)
  }

  let authRefreshAttempted = false
  let serviceUnavailableRetries = 0
  const max503Retries = 2

  while (true) {
    try {
      return await invokeLegalConsentDirect<T>(body, token, idempotencyKey)
    } catch (error: unknown) {
      const status = getErrorStatus(error)

      if (status === 401 && !authRefreshAttempted) {
        authRefreshAttempted = true
        const refreshed = await refreshAndGetAccessToken()
        if (!refreshed || refreshed === token) throw error
        token = refreshed
        continue
      }

      if (status === 503 && serviceUnavailableRetries < max503Retries) {
        const backoffMs = computeBackoffMs(serviceUnavailableRetries)
        serviceUnavailableRetries += 1
        await sleep(backoffMs)
        continue
      }

      throw error
    }
  }
}

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error) throw error
  if (!user?.id) throw new Error("Usuario autenticado no encontrado.")
  return user.id
}

async function getActiveLegalTermFromTable() {
  const { data, error } = await supabase
    .from("legal_terms_versions")
    .select("id,code,title,version,content")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ?? null
}

async function getLegalConsentStatusFallback() {
  const userId = await getCurrentUserId()
  const activeTerm = await getActiveLegalTermFromTable()

  if (!activeTerm) {
    return {
      accepted: false,
      accepted_at: null,
      active_term: null,
    } satisfies LegalConsentStatus
  }

  const { data, error } = await supabase
    .from("user_legal_acceptances")
    .select("accepted_at")
    .eq("user_id", userId)
    .eq("legal_terms_id", activeTerm.id)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error

  return {
    accepted: !!data?.accepted_at,
    accepted_at: data?.accepted_at ?? null,
    active_term: {
      id: activeTerm.id,
      code: activeTerm.code,
      title: activeTerm.title,
      version: activeTerm.version,
      content: activeTerm.content,
    },
  } satisfies LegalConsentStatus
}

async function acceptLegalConsentFallback(legalTermsId?: number) {
  const userId = await getCurrentUserId()
  const resolvedTermsId = legalTermsId ?? (await getActiveLegalTermFromTable())?.id

  if (!resolvedTermsId) {
    throw new Error("No se encontro una version activa de terminos legales.")
  }

  const acceptedAt = new Date().toISOString()
  const userAgent = typeof window !== "undefined" ? window.navigator.userAgent : null

  const { error } = await supabase.from("user_legal_acceptances").upsert(
    {
      user_id: userId,
      legal_terms_id: resolvedTermsId,
      accepted_at: acceptedAt,
      user_agent: userAgent,
    },
    {
      onConflict: "user_id,legal_terms_id",
    }
  )

  if (error) throw error
  return { accepted: true, accepted_at: acceptedAt }
}

export async function getLegalConsentStatus(accessToken?: string) {
  try {
    const data = await invokeLegalConsentWithRetry<LegalConsentStatus>(
      { action: "status" },
      accessToken
    )
    const normalized = (data ?? { accepted: false, accepted_at: null, active_term: null }) as LegalConsentStatus

    if (normalized.active_term && !normalized.active_term.content) {
      try {
        const activeTerm = await getActiveLegalTermFromTable()
        if (activeTerm && (!normalized.active_term.id || normalized.active_term.id === activeTerm.id)) {
          normalized.active_term = {
            id: normalized.active_term.id ?? activeTerm.id,
            code: normalized.active_term.code ?? activeTerm.code,
            title: normalized.active_term.title ?? activeTerm.title,
            version: normalized.active_term.version ?? activeTerm.version,
            content: activeTerm.content ?? null,
          }
        }
      } catch {
        // Si falla la carga de contenido legal, mantenemos el estado base sin romper login.
      }
    }

    return normalized
  } catch (error: unknown) {
    // Fallback only for transport-layer issues (CORS/network). AUTH errors must bubble up.
    if (getErrorStatus(error) === 401) {
      throw error
    }
    if (!shouldFallbackToDirectTableAccess(error)) throw error
    return getLegalConsentStatusFallback()
  }
}

export async function acceptLegalConsent(legalTermsId?: number, accessToken?: string) {
  try {
    const data = await invokeLegalConsentWithRetry<{ accepted?: boolean; accepted_at?: string | null } | null>(
      {
        action: "accept",
        legal_terms_id: legalTermsId,
      },
      accessToken,
      crypto.randomUUID()
    )
    return (data ?? null) as { accepted?: boolean; accepted_at?: string | null } | null
  } catch (error: unknown) {
    if (getErrorStatus(error) === 401) {
      throw error
    }
    if (!shouldFallbackToDirectTableAccess(error)) throw error
    return acceptLegalConsentFallback(legalTermsId)
  }
}

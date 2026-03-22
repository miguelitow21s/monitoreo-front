import { supabase } from "@/services/supabaseClient"
import { getOrCreateDeviceFingerprint } from "@/services/securityContext.service"

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
  if (!baseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.")
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured.")

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    apikey: anonKey,
    "Content-Type": "application/json",
    "x-device-fingerprint": getOrCreateDeviceFingerprint(),
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
    const message = payload?.error?.message ?? fallbackBodyMessage ?? `legal_consent failed (HTTP ${response.status})`
    throw toStatusError(message, response.status, requestId, sbRequestId, xRequestId, rawBody?.trim() || undefined)
  }

  if (payload && "success" in payload && payload.success === false) {
    const requestId = payload.request_id ?? payload.error?.request_id
    const xRequestId = response.headers.get("x-request-id") ?? undefined
    const sbRequestId = response.headers.get("sb-request-id") ?? undefined
    const message = payload.error?.message ?? "legal_consent was rejected by backend."
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
    throw toStatusError("Authenticated session token is not available.", 401)
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

export async function getLegalConsentStatus(accessToken?: string) {
  const data = await invokeLegalConsentWithRetry<LegalConsentStatus>(
    { action: "status" },
    accessToken
  )
  return (data ?? { accepted: false, accepted_at: null, active_term: null }) as LegalConsentStatus
}

export async function acceptLegalConsent(legalTermsId?: number, accessToken?: string) {
  const data = await invokeLegalConsentWithRetry<{ accepted?: boolean; accepted_at?: string | null } | null>(
    {
      action: "accept",
      legal_terms_id: legalTermsId,
    },
    accessToken,
    crypto.randomUUID()
  )
  return (data ?? null) as { accepted?: boolean; accepted_at?: string | null } | null
}

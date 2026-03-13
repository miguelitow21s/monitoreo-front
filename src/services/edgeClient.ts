import { supabase } from "@/services/supabaseClient"

interface BackendEnvelope<T> {
  success?: boolean
  data?: T | null
  error?: {
    code?: string
    message?: string
    category?: string
    request_id?: string
  } | null
  request_id?: string
}

type EdgeInvokeOptions = {
  body?: Record<string, unknown> | string | Blob | ArrayBuffer | FormData
  idempotencyKey?: string
  accessToken?: string
  extraHeaders?: Record<string, string>
}

let edgeUnavailableUntilMs = 0
const EDGE_UNAVAILABLE_COOLDOWN_MS = 2 * 60 * 1000

function isEdgeTemporarilyUnavailable() {
  return Date.now() < edgeUnavailableUntilMs
}

function markEdgeTemporarilyUnavailable() {
  edgeUnavailableUntilMs = Date.now() + EDGE_UNAVAILABLE_COOLDOWN_MS
}

function isNetworkOrCorsFailure(message: string, status?: unknown) {
  if (typeof status === "number") return false
  const normalized = message.toLowerCase()
  return (
    normalized.includes("failed to fetch") ||
    normalized.includes("failed to send a request") ||
    normalized.includes("network") ||
    normalized.includes("cors")
  )
}

function toError(message: string, status?: number, code?: string, requestId?: string) {
  const decoratedMessage = requestId ? `${message} (request_id: ${requestId})` : message
  const err = new Error(decoratedMessage) as Error & { status?: number; code?: string; request_id?: string }
  if (typeof status === "number") err.status = status
  if (code) err.code = code
  if (requestId) err.request_id = requestId
  return err
}

export async function invokeEdge<T>(fn: string, options: EdgeInvokeOptions = {}) {
  if (isEdgeTemporarilyUnavailable()) {
    throw toError(
      "Edge Function temporarily unavailable. Retrying with fallback path.",
      503,
      "EDGE_TEMP_UNAVAILABLE"
    )
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (anonKey) {
    headers.apikey = anonKey
  }

  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey
  }

  let token = options.accessToken
  if (!token) {
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token ?? undefined
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  if (options.extraHeaders) {
    for (const [key, value] of Object.entries(options.extraHeaders)) {
      if (typeof value === "string" && value.trim().length > 0) {
        headers[key] = value
      }
    }
  }

  const { data, error } = await supabase.functions.invoke(fn, {
    headers,
    body: options.body as Record<string, unknown> | string | Blob | ArrayBuffer | FormData | undefined,
  })

  if (error) {
    const status = (error as { status?: unknown }).status
    if (isNetworkOrCorsFailure(error.message ?? "", status)) {
      markEdgeTemporarilyUnavailable()
    }
    throw toError(error.message ?? "Edge Function request failed.", typeof status === "number" ? status : undefined)
  }

  const envelope = (data ?? null) as BackendEnvelope<T> | null
  if (envelope && typeof envelope === "object" && "success" in envelope) {
    if (!envelope.success) {
      const message = envelope.error?.message ?? "Request was rejected by backend."
      const rawCode = envelope.error?.code
      const parsedStatus =
        typeof rawCode === "number"
          ? rawCode
          : typeof rawCode === "string" && /^\d{3}$/.test(rawCode)
            ? Number(rawCode)
            : undefined
      throw toError(
        message,
        parsedStatus,
        typeof rawCode === "string" ? rawCode : typeof rawCode === "number" ? String(rawCode) : undefined,
        envelope.request_id ?? envelope.error?.request_id
      )
    }
    return (envelope.data ?? null) as T
  }

  return data as T
}

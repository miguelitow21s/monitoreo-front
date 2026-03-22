import { supabase } from "@/services/supabaseClient"
import { getOrCreateDeviceFingerprint } from "@/services/securityContext.service"
import { debugGroup, debugLog, isDebugAllEnabled, isDebugEnabled } from "@/services/debug"

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
const DEBUG_ENDPOINTS = new Set([
  "employee_self_service",
  "operational_tasks_manage",
  "restaurant_staff_manage",
  "supplies_deliver",
  "scheduled_shifts_manage",
  "shifts_start",
  "shifts_end",
  "shifts_approve",
  "shifts_reject",
  "evidence_upload",
  "incidents_create",
  "supervisor_presence_manage",
  "health_ping",
])

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

async function extractErrorContext(error: unknown) {
  const fallbackMessage = "Edge Function request failed."
  if (!error || typeof error !== "object") {
    return { message: fallbackMessage } as {
      message: string
      status?: number
      code?: string
      requestId?: string
    }
  }

  const err = error as {
    message?: string
    status?: unknown
    context?: { status?: unknown; body?: unknown; headers?: Record<string, string> }
    body?: unknown
  }

  let status =
    typeof err.status === "number"
      ? err.status
      : typeof err.context?.status === "number"
        ? err.context?.status
        : undefined
  let message = err.message ?? fallbackMessage
  let code: string | undefined
  let requestId: string | undefined

  const headerRequestId = (() => {
    const headers = err.context?.headers
    if (!headers) return null
    const entries = Object.entries(headers)
    const match = entries.find(([key]) => key.toLowerCase() === "x-request-id")
    return match?.[1] ?? null
  })()

  const rawBody = err.context?.body ?? err.body
  if (rawBody) {
    try {
      let parsed: Record<string, unknown> | null = null
      let rawText: string | null = null

      if (typeof rawBody === "string") {
        rawText = rawBody
      } else if (rawBody instanceof ArrayBuffer) {
        rawText = new TextDecoder().decode(rawBody)
      } else if (ArrayBuffer.isView(rawBody)) {
        rawText = new TextDecoder().decode(rawBody)
      } else if (typeof (rawBody as { text?: unknown }).text === "function") {
        rawText = await (rawBody as { text: () => Promise<string> }).text()
      } else if (typeof rawBody === "object" && rawBody !== null) {
        parsed = rawBody as Record<string, unknown>
      }

      if (rawText) {
        parsed = JSON.parse(rawText) as Record<string, unknown>
      }

      if (parsed) {
        const envelopeError = parsed?.error as Record<string, unknown> | undefined
        const envelopeRequestId = parsed?.request_id as string | undefined
        const envelopeMessage = envelopeError?.message as string | undefined
        const envelopeCode = envelopeError?.code as string | number | undefined
        if (envelopeMessage) {
          message = envelopeMessage
        }
        if (envelopeRequestId) {
          requestId = envelopeRequestId
        }
        if (typeof envelopeCode === "number") {
          code = String(envelopeCode)
          status = status ?? envelopeCode
        } else if (typeof envelopeCode === "string") {
          code = envelopeCode
          if (/^\d{3}$/.test(envelopeCode)) {
            status = status ?? Number(envelopeCode)
          }
        }
        const directMessage = parsed?.message as string | undefined
        if (!envelopeMessage && directMessage) {
          message = directMessage
        }
      } else if (rawText) {
        const trimmed = rawText.trim()
        if (trimmed) {
          const match = trimmed.match(/\"message\"\s*:\s*\"([^\"]+)\"/)
          message = match?.[1] ?? trimmed
        }
      }
    } catch {
      if (typeof rawBody === "string") {
        const trimmed = rawBody.trim()
        if (trimmed) {
          const match = trimmed.match(/\"message\"\s*:\s*\"([^\"]+)\"/)
          message = match?.[1] ?? trimmed
        }
      }
    }
  }

  if (!requestId && headerRequestId) {
    requestId = headerRequestId
  }

  return { message, status, code, requestId }
}

function shouldDebugEndpoint(fn: string) {
  return isDebugEnabled() && (isDebugAllEnabled() || DEBUG_ENDPOINTS.has(fn))
}

function redactHeaders(headers: Record<string, string>) {
  const redacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (
      lower.includes("authorization") ||
      lower.includes("apikey") ||
      lower.includes("otp") ||
      lower === "x-device-fingerprint" ||
      lower === "x-device-id" ||
      lower === "x-device-key"
    ) {
      redacted[key] = "[redacted]"
    } else {
      redacted[key] = value
    }
  }
  return redacted
}

function redactBody(body: EdgeInvokeOptions["body"]) {
  if (!body) return null
  if (typeof body === "string") return body
  if (body instanceof Blob) return `[Blob ${body.type || "unknown"} ${body.size} bytes]`
  if (body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength} bytes]`
  if (body instanceof FormData) return "[FormData]"
  if (typeof body !== "object") return body

  try {
    const raw = body as Record<string, unknown>
    const cloned = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
    for (const key of Object.keys(cloned)) {
      const lower = key.toLowerCase()
      if (lower.includes("password") || lower.includes("token") || lower.includes("otp") || lower.includes("code")) {
        cloned[key] = "[redacted]"
      }
    }
    return cloned
  } catch {
    return "[unserializable body]"
  }
}

function extractActionAndRestaurant(body: EdgeInvokeOptions["body"]) {
  if (!body || typeof body !== "object") return null
  if (body instanceof Blob || body instanceof ArrayBuffer || body instanceof FormData) return null
  const raw = body as Record<string, unknown>
  const action = typeof raw.action === "string" ? raw.action : null
  const restaurantId =
    typeof raw.restaurant_id === "number" || typeof raw.restaurant_id === "string"
      ? raw.restaurant_id
      : typeof raw.restaurantId === "number" || typeof raw.restaurantId === "string"
        ? raw.restaurantId
        : null
  if (!action && restaurantId === null) return null
  return { action: action ?? null, restaurant_id: restaurantId }
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

  const hasDeviceHeader = Object.keys(headers).some(key => {
    const lower = key.toLowerCase()
    return lower === "x-device-fingerprint" || lower === "x-device-id" || lower === "x-device-key"
  })
  if (!hasDeviceHeader) {
    headers["x-device-fingerprint"] = getOrCreateDeviceFingerprint()
  }

  if (shouldDebugEndpoint(fn)) {
    debugGroup(`edge.request ${fn}`, {
      method: "POST",
      idempotencyKey: options.idempotencyKey ?? null,
      headers: redactHeaders(headers),
      body: redactBody(options.body),
    })
    const summary = extractActionAndRestaurant(options.body)
    if (summary) {
      debugLog(`edge.summary ${fn}`, summary)
    }
  }

  const { data, error } = await supabase.functions.invoke(fn, {
    headers,
    body: options.body as Record<string, unknown> | string | Blob | ArrayBuffer | FormData | undefined,
  })

  if (error) {
    const extracted = await extractErrorContext(error)
    const status = extracted.status ?? (error as { status?: unknown }).status
    if (isNetworkOrCorsFailure(error.message ?? "", status)) {
      markEdgeTemporarilyUnavailable()
    }
    if (shouldDebugEndpoint(fn)) {
      debugGroup(`edge.error ${fn}`, {
        message: extracted.message ?? error.message ?? "Edge Function request failed.",
        status: typeof status === "number" ? status : null,
      })
    }
    throw toError(
      extracted.message ?? error.message ?? "Edge Function request failed.",
      typeof status === "number" ? status : undefined,
      extracted.code,
      extracted.requestId
    )
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
      if (shouldDebugEndpoint(fn)) {
        debugGroup(`edge.envelope_error ${fn}`, {
          message,
          status: parsedStatus ?? null,
          code: rawCode ?? null,
          request_id: envelope.request_id ?? envelope.error?.request_id ?? null,
          body: redactBody(options.body),
        })
      }
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

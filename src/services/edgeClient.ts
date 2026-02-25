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
}

function toError(message: string, status?: number, code?: string, requestId?: string) {
  const err = new Error(message) as Error & { status?: number; code?: string; request_id?: string }
  if (typeof status === "number") err.status = status
  if (code) err.code = code
  if (requestId) err.request_id = requestId
  return err
}

export async function invokeEdge<T>(fn: string, options: EdgeInvokeOptions = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey
  }

  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`
  }

  const { data, error } = await supabase.functions.invoke(fn, {
    headers,
    body: options.body as Record<string, unknown> | string | Blob | ArrayBuffer | FormData | undefined,
  })

  if (error) {
    const status = (error as { status?: unknown }).status
    throw toError(error.message ?? "Edge function request failed.", typeof status === "number" ? status : undefined)
  }

  const envelope = (data ?? null) as BackendEnvelope<T> | null
  if (envelope && typeof envelope === "object" && "success" in envelope) {
    if (!envelope.success) {
      const message = envelope.error?.message ?? "Backend request rejected."
      throw toError(message, undefined, envelope.error?.code, envelope.request_id ?? envelope.error?.request_id)
    }
    return (envelope.data ?? null) as T
  }

  return data as T
}

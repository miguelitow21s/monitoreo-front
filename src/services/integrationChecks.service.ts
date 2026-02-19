import { supabase } from "@/services/supabaseClient"

export type CheckStatus = "pass" | "warn" | "fail"

export interface IntegrationCheckResult {
  endpoint: string
  status: CheckStatus
  detail: string
}

interface EdgeResponseEnvelope {
  success?: boolean
  data?: unknown
  error?: {
    code?: string
    message?: string
    category?: string
    request_id?: string
  } | null
  request_id?: string
}

function isExpectedValidationOrBusinessStatus(status: number) {
  return [401, 403, 409, 415, 422].includes(status)
}

async function callEdge(endpoint: string, method: "GET" | "POST", body?: unknown, idempotencyKey?: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error("No active session token.")
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.")
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
  }

  if (method === "POST") {
    headers["Content-Type"] = "application/json"
  }

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey
  }

  const response = await fetch(`${baseUrl}/functions/v1/${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  let payload: EdgeResponseEnvelope | null = null
  try {
    payload = (await response.json()) as EdgeResponseEnvelope
  } catch {
    payload = null
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
  }
}

export async function runBackendIntegrationChecks() {
  const results: IntegrationCheckResult[] = []

  const health = await callEdge("health_ping", "GET")
  if (health.ok) {
    results.push({ endpoint: "/health_ping", status: "pass", detail: "reachable" })
  } else {
    results.push({ endpoint: "/health_ping", status: "fail", detail: `HTTP ${health.status}` })
  }

  const consent = await callEdge("legal_consent", "POST", { action: "status" })
  if (consent.ok) {
    results.push({ endpoint: "/legal_consent", status: "pass", detail: "status retrieved" })
  } else if (isExpectedValidationOrBusinessStatus(consent.status)) {
    results.push({ endpoint: "/legal_consent", status: "warn", detail: `reachable with HTTP ${consent.status}` })
  } else {
    results.push({ endpoint: "/legal_consent", status: "fail", detail: `HTTP ${consent.status}` })
  }

  const shiftsStart = await callEdge(
    "shifts_start",
    "POST",
    {
      restaurant_id: -1,
      lat: 0,
      lng: 0,
      fit_for_work: true,
      declaration: "integration-check",
    },
    crypto.randomUUID()
  )
  if (shiftsStart.ok) {
    results.push({ endpoint: "/shifts_start", status: "pass", detail: "accepted request" })
  } else if (isExpectedValidationOrBusinessStatus(shiftsStart.status)) {
    results.push({ endpoint: "/shifts_start", status: "warn", detail: `reachable with HTTP ${shiftsStart.status}` })
  } else {
    results.push({ endpoint: "/shifts_start", status: "fail", detail: `HTTP ${shiftsStart.status}` })
  }

  const evidence = await callEdge(
    "evidence_upload",
    "POST",
    {
      action: "request_upload",
      shift_id: -1,
      type: "inicio",
    },
    crypto.randomUUID()
  )
  if (evidence.ok) {
    results.push({ endpoint: "/evidence_upload", status: "pass", detail: "request_upload accepted" })
  } else if (isExpectedValidationOrBusinessStatus(evidence.status)) {
    results.push({ endpoint: "/evidence_upload", status: "warn", detail: `reachable with HTTP ${evidence.status}` })
  } else {
    results.push({ endpoint: "/evidence_upload", status: "fail", detail: `HTTP ${evidence.status}` })
  }

  const shiftsEnd = await callEdge(
    "shifts_end",
    "POST",
    {
      shift_id: -1,
      lat: 0,
      lng: 0,
      fit_for_work: true,
      declaration: "integration-check",
    },
    crypto.randomUUID()
  )
  if (shiftsEnd.ok) {
    results.push({ endpoint: "/shifts_end", status: "pass", detail: "accepted request" })
  } else if (isExpectedValidationOrBusinessStatus(shiftsEnd.status)) {
    results.push({ endpoint: "/shifts_end", status: "warn", detail: `reachable with HTTP ${shiftsEnd.status}` })
  } else {
    results.push({ endpoint: "/shifts_end", status: "fail", detail: `HTTP ${shiftsEnd.status}` })
  }

  return results
}

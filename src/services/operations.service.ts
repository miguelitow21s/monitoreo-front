import { createEvidenceSignedUrl } from "@/services/storageEvidence.service"
import { invokeEdge } from "@/services/edgeClient"
import { getShiftOtpToken } from "@/services/securityContext.service"
import { ensureTrustedDeviceReady } from "@/services/trustedDevice.service"
import { debugLog } from "@/services/debug"

export interface SupervisorShiftRow {
  id: string
  employee_id?: string | null
  restaurant_id?: number | null
  start_time: string
  end_time: string | null
  status: string
  start_evidence_path?: string | null
  end_evidence_path?: string | null
}

export interface ShiftIncident {
  id: string
  shift_id: string
  note: string
  created_at: string
}

function toStringId(value: unknown) {
  if (typeof value === "string" && value.trim()) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function unwrapItems(payload: unknown) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== "object") return [] as unknown[]
  const wrapped = payload as { items?: unknown }
  return Array.isArray(wrapped.items) ? wrapped.items : []
}

function normalizeSupervisorShift(raw: unknown): SupervisorShiftRow | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>

  const id = toStringId(row.id ?? row.shift_id)
  const startTime = typeof row.start_time === "string" ? row.start_time : null

  if (!id || !startTime) return null

  const restaurantIdRaw =
    typeof row.restaurant_id === "number"
      ? row.restaurant_id
      : typeof row.restaurant_id === "string"
        ? Number(row.restaurant_id)
        : null
  const restaurantId = Number.isFinite(restaurantIdRaw ?? NaN) ? (restaurantIdRaw as number) : null

  return {
    id,
    employee_id: toStringId(row.employee_id),
    restaurant_id: restaurantId,
    start_time: startTime,
    end_time: typeof row.end_time === "string" ? row.end_time : null,
    status: typeof row.status === "string" ? row.status : "active",
    start_evidence_path: typeof row.start_evidence_path === "string" ? row.start_evidence_path : null,
    end_evidence_path: typeof row.end_evidence_path === "string" ? row.end_evidence_path : null,
  }
}

function normalizeIncident(raw: unknown): ShiftIncident | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const id = toStringId(row.id)
  const shiftId = toStringId(row.shift_id)
  const note = typeof row.note === "string" ? row.note : typeof row.description === "string" ? row.description : null
  const createdAt = typeof row.created_at === "string" ? row.created_at : null

  if (!id || !shiftId || !note || !createdAt) return null

  return {
    id,
    shift_id: shiftId,
    note,
    created_at: createdAt,
  }
}

function parseShiftId(shiftId: string) {
  const parsed = Number(shiftId)
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid shift id.")
  }
  return parsed
}

async function getShiftSecureHeaders() {
  const otpToken = getShiftOtpToken()
  if (!otpToken) {
    throw new Error("OTP token is required. Verify your phone before approving/rejecting shifts or creating incidents.")
  }

  const { fingerprint } = await ensureTrustedDeviceReady()
  return {
    "x-device-fingerprint": fingerprint,
    "x-shift-otp-token": otpToken,
  }
}

export async function getActiveShiftsForSupervision(limit = 20) {
  const payload = await invokeEdge<unknown>("shifts_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list_active",
      limit,
    },
  })

  return unwrapItems(payload)
    .map(normalizeSupervisorShift)
    .filter((row): row is SupervisorShiftRow => row !== null)
}

export async function updateShiftStatus(shiftId: string, status: string) {
  if (status === "approved" || status === "rejected") {
    const endpoint = status === "approved" ? "shifts_approve" : "shifts_reject"
    debugLog("supervisor.shift.status.edge", { shiftId, status, endpoint })
    try {
      await invokeEdge(endpoint, {
        idempotencyKey: crypto.randomUUID(),
        extraHeaders: await getShiftSecureHeaders(),
        body: {
          shift_id: parseShiftId(shiftId),
        },
      })
    } catch (error: unknown) {
      debugLog("supervisor.shift.status.edge_error", {
        shiftId,
        status,
        message: error instanceof Error ? error.message : "edge status update failed",
      })
      throw error
    }
    return
  }

  throw new Error("Shift status updates are only supported for approved/rejected from the frontend.")
}

export async function createShiftIncident(shiftId: string, note: string) {
  const payload = await invokeEdge<unknown>("incidents_create", {
    idempotencyKey: crypto.randomUUID(),
    extraHeaders: await getShiftSecureHeaders(),
    body: {
      shift_id: parseShiftId(shiftId),
      description: note,
    },
  })

  const incidentId =
    payload && typeof payload === "object" && "incident_id" in (payload as Record<string, unknown>)
      ? (payload as Record<string, unknown>).incident_id
      : null

  return {
    id: typeof incidentId === "number" ? String(incidentId) : String(incidentId ?? ""),
    shift_id: shiftId,
    note,
    created_at: new Date().toISOString(),
  } as ShiftIncident
}

export async function getShiftIncidents(shiftId: string) {
  const payload = await invokeEdge<unknown>("incidents_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list_by_shift",
      shift_id: parseShiftId(shiftId),
    },
  })

  return unwrapItems(payload)
    .map(normalizeIncident)
    .filter((row): row is ShiftIncident => row !== null)
}

export async function resolveEvidenceUrl(path: string | null | undefined, expiresInSeconds = 3600) {
  if (!path) return null
  return createEvidenceSignedUrl(path, expiresInSeconds)
}

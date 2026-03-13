import { supabase } from "@/services/supabaseClient"
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
  const { data, error } = await supabase
    .from("shifts")
    .select("*")
    .is("end_time", null)
    .order("start_time", { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as SupervisorShiftRow[]
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

  const { error } = await supabase.from("shifts").update({ status }).eq("id", shiftId)
  if (error) throw error
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
  const { data, error } = await supabase
    .from("shift_incidents")
    .select("id,shift_id,note,created_at")
    .eq("shift_id", shiftId)
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data ?? []) as ShiftIncident[]
}

export async function resolveEvidenceUrl(path: string | null | undefined, expiresInSeconds = 3600) {
  if (!path) return null
  return createEvidenceSignedUrl(path, expiresInSeconds)
}

import { supabase } from "@/services/supabaseClient"
import { createEvidenceSignedUrl } from "@/services/storageEvidence.service"
import { invokeEdge } from "@/services/edgeClient"

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
  const { error } = await supabase.from("shifts").update({ status }).eq("id", shiftId)
  if (error) throw error
}

export async function createShiftIncident(shiftId: string, note: string) {
  const payload = await invokeEdge<unknown>("incidents_create", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      shift_id: Number(shiftId),
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

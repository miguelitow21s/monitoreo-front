import { supabase } from "@/services/supabaseClient"

type PresencePhase = "start" | "end"

export interface SupervisorPresenceLog {
  id: number
  supervisor_id: string
  restaurant_id: number
  phase: PresencePhase
  lat: number
  lng: number
  evidence_path: string
  evidence_hash: string
  evidence_mime_type: string
  evidence_size_bytes: number
  recorded_at: string
  notes: string | null
}

interface RegisterSupervisorPresencePayload {
  restaurantId: number
  phase: PresencePhase
  lat: number
  lng: number
  notes?: string | null
  evidencePath: string
  evidenceHash: string
  evidenceMimeType: string
  evidenceSizeBytes: number
}

export async function registerSupervisorPresence(payload: RegisterSupervisorPresencePayload) {
  const { data, error } = await supabase
    .from("supervisor_presence_logs")
    .insert({
      restaurant_id: payload.restaurantId,
      phase: payload.phase,
      lat: payload.lat,
      lng: payload.lng,
      notes: payload.notes ?? null,
      evidence_path: payload.evidencePath,
      evidence_hash: payload.evidenceHash,
      evidence_mime_type: payload.evidenceMimeType,
      evidence_size_bytes: payload.evidenceSizeBytes,
    })
    .select("*")
    .single()

  if (error) throw error
  return data as SupervisorPresenceLog
}

export async function listMySupervisorPresence(limit = 20) {
  const { data, error } = await supabase
    .from("supervisor_presence_logs")
    .select("*")
    .order("recorded_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as SupervisorPresenceLog[]
}

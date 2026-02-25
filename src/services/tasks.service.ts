import { supabase } from "@/services/supabaseClient"

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled"
export type TaskPriority = "low" | "normal" | "high" | "critical"
export type TaskEvidenceShotKey = "close_up" | "mid_range" | "wide_general" | string

export interface OperationalTask {
  id: number
  shift_id: number
  restaurant_id: number
  assigned_employee_id: string
  created_by: string
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus
  due_at: string | null
  resolved_at: string | null
  resolved_by: string | null
  evidence_path: string | null
  evidence_hash: string | null
  evidence_mime_type: string | null
  evidence_size_bytes: number | null
  created_at: string
  updated_at: string
}

interface CreateOperationalTaskPayload {
  shiftId: number
  restaurantId: number
  assignedEmployeeId: string
  title: string
  description: string
  priority?: TaskPriority
  dueAt?: string | null
}

interface CompleteOperationalTaskPayload {
  taskId: number
  evidencePath: string
  evidenceHash: string
  evidenceMimeType: string
  evidenceSizeBytes: number
}

export interface TaskEvidenceManifestItem {
  shot: TaskEvidenceShotKey
  label: string
  path: string
  signedUrl: string | null
  evidenceHash: string | null
  evidenceMimeType: string | null
  evidenceSizeBytes: number | null
}

export interface TaskEvidenceManifestResolved {
  taskId: number
  capturedAt: string | null
  capturedBy: string | null
  gps: { lat: number; lng: number } | null
  manifestPath: string
  manifestSignedUrl: string | null
  evidences: TaskEvidenceManifestItem[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function toNullableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function normalizeTaskShotLabel(shot: TaskEvidenceShotKey) {
  if (shot === "close_up") return "Primer plano"
  if (shot === "mid_range") return "Plano medio"
  if (shot === "wide_general") return "Vista general"
  return shot.replaceAll("_", " ")
}

function extractEvidencePath(rawEvidence: Record<string, unknown>) {
  const pathCandidate =
    (typeof rawEvidence.filePath === "string" && rawEvidence.filePath) ||
    (typeof rawEvidence.path === "string" && rawEvidence.path) ||
    (typeof rawEvidence.evidence_path === "string" && rawEvidence.evidence_path) ||
    null
  return pathCandidate
}

export async function resolveTaskEvidenceSignedUrl(path: string | null | undefined, expiresInSeconds = 3600) {
  if (!path) return null
  const { data, error } = await supabase.storage.from("shift-evidence").createSignedUrl(path, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}

export async function fetchTaskEvidenceManifest(
  task: Pick<OperationalTask, "id" | "evidence_path">,
  expiresInSeconds = 3600
) {
  if (!task.evidence_path) {
    throw new Error("La tarea no tiene evidencia registrada.")
  }

  const manifestSignedUrl = await resolveTaskEvidenceSignedUrl(task.evidence_path, expiresInSeconds)
  if (!manifestSignedUrl) {
    throw new Error("No se pudo resolver URL del manifiesto de tarea.")
  }

  const response = await fetch(manifestSignedUrl)
  if (!response.ok) {
    throw new Error(`No se pudo leer manifiesto de tarea (HTTP ${response.status}).`)
  }

  const payload = (await response.json()) as unknown
  if (!isRecord(payload)) {
    throw new Error("El manifiesto de evidencia de tarea es invalido.")
  }

  const capturedAt = typeof payload.captured_at === "string" ? payload.captured_at : null
  const capturedBy = typeof payload.captured_by === "string" ? payload.captured_by : null

  const rawGps = payload.gps
  const gps = isRecord(rawGps)
    ? (() => {
        const lat = toNullableNumber(rawGps.lat)
        const lng = toNullableNumber(rawGps.lng)
        if (lat === null || lng === null) return null
        return { lat, lng }
      })()
    : null

  const rawEvidences = Array.isArray(payload.evidences) ? payload.evidences : []
  const evidenceRows = await Promise.all(
    rawEvidences
      .filter(isRecord)
      .map(async rawEvidence => {
        const shot = typeof rawEvidence.shot === "string" ? rawEvidence.shot : "evidence"
        const path = extractEvidencePath(rawEvidence)
        if (!path) return null

        const signedUrl = await resolveTaskEvidenceSignedUrl(path, expiresInSeconds)
        return {
          shot,
          label: normalizeTaskShotLabel(shot),
          path,
          signedUrl,
          evidenceHash:
            typeof rawEvidence.evidenceHash === "string"
              ? rawEvidence.evidenceHash
              : typeof rawEvidence.evidence_hash === "string"
                ? rawEvidence.evidence_hash
                : null,
          evidenceMimeType:
            typeof rawEvidence.evidenceMimeType === "string"
              ? rawEvidence.evidenceMimeType
              : typeof rawEvidence.evidence_mime_type === "string"
                ? rawEvidence.evidence_mime_type
                : null,
          evidenceSizeBytes:
            toNullableNumber(rawEvidence.evidenceSizeBytes) ?? toNullableNumber(rawEvidence.evidence_size_bytes),
        } satisfies TaskEvidenceManifestItem
      })
  )

  return {
    taskId: task.id,
    capturedAt,
    capturedBy,
    gps,
    manifestPath: task.evidence_path,
    manifestSignedUrl,
    evidences: evidenceRows.filter((item): item is TaskEvidenceManifestItem => item !== null),
  } satisfies TaskEvidenceManifestResolved
}

export async function listMyOperationalTasks(limit = 30) {
  const { data, error } = await supabase
    .from("operational_tasks")
    .select("*")
    .in("status", ["pending", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as OperationalTask[]
}

export async function listSupervisorOperationalTasks(limit = 50) {
  const { data, error } = await supabase
    .from("operational_tasks")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as OperationalTask[]
}

export async function createOperationalTask(payload: CreateOperationalTaskPayload) {
  const { data, error } = await supabase
    .from("operational_tasks")
    .insert({
      shift_id: payload.shiftId,
      restaurant_id: payload.restaurantId,
      assigned_employee_id: payload.assignedEmployeeId,
      title: payload.title.trim(),
      description: payload.description.trim(),
      priority: payload.priority ?? "normal",
      due_at: payload.dueAt ?? null,
    })
    .select("*")
    .single()

  if (error) throw error
  return data as OperationalTask
}

export async function markTaskInProgress(taskId: number) {
  const { data, error } = await supabase
    .from("operational_tasks")
    .update({ status: "in_progress" })
    .eq("id", taskId)
    .select("*")
    .single()

  if (error) throw error
  return data as OperationalTask
}

export async function completeOperationalTask(payload: CompleteOperationalTaskPayload) {
  const { data, error } = await supabase
    .from("operational_tasks")
    .update({
      status: "completed",
      resolved_at: new Date().toISOString(),
      evidence_path: payload.evidencePath,
      evidence_hash: payload.evidenceHash,
      evidence_mime_type: payload.evidenceMimeType,
      evidence_size_bytes: payload.evidenceSizeBytes,
    })
    .eq("id", payload.taskId)
    .select("*")
    .single()

  if (error) throw error
  return data as OperationalTask
}

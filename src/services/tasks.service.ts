import { supabase } from "@/services/supabaseClient"
import { createEvidenceSignedUrl } from "@/services/storageEvidence.service"
import { invokeEdge } from "@/services/edgeClient"

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

interface UpdateOperationalTaskPayload {
  taskId: number
  title?: string
  description?: string
  priority?: TaskPriority
  dueAt?: string | null
  assignedEmployeeId?: string | null
}

interface TaskManageUploadResponse {
  upload?: {
    token?: string
    path?: string
    signedUrl?: string
  }
  bucket?: string
  path?: string
  upload_url?: string
  signed_url?: string
  url?: string
  required_mime?: string
  headers?: Record<string, string>
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
  if (shot === "close_up") return "Close-up"
  if (shot === "mid_range") return "Mid-range"
  if (shot === "wide_general") return "Wide shot"
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

function normalizeTaskRow(raw: unknown): OperationalTask | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>

  const id = toNullableNumber(row.id)
  const shiftId = toNullableNumber(row.shift_id)
  const restaurantId = toNullableNumber(row.restaurant_id)
  const assignedEmployeeId = typeof row.assigned_employee_id === "string" ? row.assigned_employee_id : null
  const createdBy = typeof row.created_by === "string" ? row.created_by : ""
  const title = typeof row.title === "string" ? row.title : ""
  const description = typeof row.description === "string" ? row.description : ""
  const priority = (typeof row.priority === "string" ? row.priority : "normal") as TaskPriority
  const status = (typeof row.status === "string" ? row.status : "pending") as TaskStatus
  const createdAt = typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString()
  const updatedAt = typeof row.updated_at === "string" ? row.updated_at : createdAt

  if (id === null || shiftId === null || restaurantId === null || !assignedEmployeeId) return null

  return {
    id,
    shift_id: shiftId,
    restaurant_id: restaurantId,
    assigned_employee_id: assignedEmployeeId,
    created_by: createdBy,
    title,
    description,
    priority,
    status,
    due_at: typeof row.due_at === "string" ? row.due_at : null,
    resolved_at: typeof row.resolved_at === "string" ? row.resolved_at : null,
    resolved_by: typeof row.resolved_by === "string" ? row.resolved_by : null,
    evidence_path: typeof row.evidence_path === "string" ? row.evidence_path : null,
    evidence_hash: typeof row.evidence_hash === "string" ? row.evidence_hash : null,
    evidence_mime_type: typeof row.evidence_mime_type === "string" ? row.evidence_mime_type : null,
    evidence_size_bytes: toNullableNumber(row.evidence_size_bytes),
    created_at: createdAt,
    updated_at: updatedAt,
  }
}

function normalizeTaskRowsFromEnvelope(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload.map(normalizeTaskRow).filter((item): item is OperationalTask => item !== null)
  }

  if (!payload || typeof payload !== "object") return [] as OperationalTask[]
  const wrapped = payload as { items?: unknown }
  const items = Array.isArray(wrapped.items) ? wrapped.items : []
  return items.map(normalizeTaskRow).filter((item): item is OperationalTask => item !== null)
}

export async function resolveTaskEvidenceSignedUrl(path: string | null | undefined, expiresInSeconds = 3600) {
  if (!path) return null
  return createEvidenceSignedUrl(path, expiresInSeconds)
}

export async function fetchTaskEvidenceManifest(
  task: Pick<OperationalTask, "id" | "evidence_path">,
  expiresInSeconds = 3600
) {
  if (!task.evidence_path) {
    throw new Error("Task has no registered evidence.")
  }

  const manifestSignedUrl = await resolveTaskEvidenceSignedUrl(task.evidence_path, expiresInSeconds)
  if (!manifestSignedUrl) {
    throw new Error("Could not resolve task manifest URL.")
  }

  const response = await fetch(manifestSignedUrl)
  if (!response.ok) {
    throw new Error(`Could not read task manifest (HTTP ${response.status}).`)
  }

  const payload = (await response.json()) as unknown
  if (!isRecord(payload)) {
    throw new Error("Task evidence manifest is invalid.")
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
  const payload = await invokeEdge<unknown>("operational_tasks_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list_my_open",
      limit,
    },
  })

  return normalizeTaskRowsFromEnvelope(payload)
}

export async function listSupervisorOperationalTasks(limit = 50, restaurantId?: number | null) {
  const body: Record<string, unknown> = {
    action: "list_supervision",
    limit,
  }

  if (typeof restaurantId === "number" && Number.isFinite(restaurantId)) {
    body.restaurant_id = restaurantId
  }

  const payload = await invokeEdge<unknown>("operational_tasks_manage", {
    idempotencyKey: crypto.randomUUID(),
    body,
  })

  return normalizeTaskRowsFromEnvelope(payload)
}

export async function createOperationalTask(payload: CreateOperationalTaskPayload) {
  const created = await invokeEdge<unknown>("operational_tasks_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "create",
      shift_id: payload.shiftId,
      assigned_employee_id: payload.assignedEmployeeId,
      title: payload.title.trim(),
      description: payload.description.trim(),
      priority: payload.priority ?? "normal",
      due_at: payload.dueAt ?? null,
    },
  })

  const taskId =
    created && typeof created === "object" && "task_id" in (created as Record<string, unknown>)
      ? toNullableNumber((created as Record<string, unknown>).task_id)
      : null

  if (taskId === null) {
    throw new Error("Could not parse task id from create response.")
  }

  const refreshed = await listSupervisorOperationalTasks(200, payload.restaurantId)
  const found = refreshed.find(item => item.id === taskId)
  if (found) return found

  throw new Error("Task created but could not be loaded from supervision list.")
}

export async function markTaskInProgress(taskId: number) {
  const response = await invokeEdge<{ task_id?: number }>("operational_tasks_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "mark_in_progress",
      task_id: taskId,
    },
  })

  const resolvedTaskId = toNullableNumber(response?.task_id) ?? taskId

  try {
    const supervised = await listSupervisorOperationalTasks(200)
    const found = supervised.find(item => item.id === resolvedTaskId)
    if (found) return found
  } catch {
    // ignore
  }

  try {
    const mine = await listMyOperationalTasks(200)
    const found = mine.find(item => item.id === resolvedTaskId)
    if (found) return found
  } catch {
    // ignore
  }

  return { id: resolvedTaskId } as OperationalTask
}

export async function updateOperationalTaskDetails(payload: UpdateOperationalTaskPayload) {
  const body: Record<string, unknown> = {
    action: "update",
    task_id: payload.taskId,
  }

  if (typeof payload.title === "string") body.title = payload.title.trim()
  if (typeof payload.description === "string") body.description = payload.description.trim()
  if (typeof payload.priority === "string") body.priority = payload.priority
  if (payload.dueAt !== undefined) body.due_at = payload.dueAt
  if (payload.assignedEmployeeId !== undefined) body.assigned_employee_id = payload.assignedEmployeeId

  if (Object.keys(body).length <= 2) {
    throw new Error("No task updates provided.")
  }

  const response = await invokeEdge<{ task_id?: number }>("operational_tasks_manage", {
    idempotencyKey: crypto.randomUUID(),
    body,
  })

  const resolvedTaskId = toNullableNumber(response?.task_id) ?? payload.taskId

  try {
    const refreshed = await listSupervisorOperationalTasks(200)
    const found = refreshed.find(item => item.id === resolvedTaskId)
    if (found) return found
  } catch {
    // ignore
  }

  try {
    const mine = await listMyOperationalTasks(200)
    const found = mine.find(item => item.id === resolvedTaskId)
    if (found) return found
  } catch {
    // ignore
  }

  return { id: resolvedTaskId } as OperationalTask
}

export async function closeOperationalTask(taskId: number, reason?: string | null) {
  const response = await invokeEdge<{ task_id?: number }>("operational_tasks_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "close",
      task_id: taskId,
      ...(reason ? { reason } : {}),
    },
  })

  const resolvedTaskId = toNullableNumber(response?.task_id) ?? taskId

  try {
    const supervised = await listSupervisorOperationalTasks(200)
    const found = supervised.find(item => item.id === resolvedTaskId)
    if (found) return found
  } catch {
    // ignore
  }

  try {
    const mine = await listMyOperationalTasks(200)
    const found = mine.find(item => item.id === resolvedTaskId)
    if (found) return found
  } catch {
    // ignore
  }

  return { id: resolvedTaskId } as OperationalTask
}

export async function cancelOperationalTask(taskId: number, reason?: string | null) {
  const response = await invokeEdge<{ task_id?: number }>("operational_tasks_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "cancel",
      task_id: taskId,
      ...(reason ? { reason } : {}),
    },
  })

  const resolvedTaskId = toNullableNumber(response?.task_id) ?? taskId
  return { id: resolvedTaskId } as OperationalTask
}

export async function deleteOperationalTask(taskId: number) {
  throw new Error("Delete task is not supported. Use cancel instead.")
}

export async function completeOperationalTask(payload: CompleteOperationalTaskPayload) {
  await invokeEdge("operational_tasks_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "complete",
      task_id: payload.taskId,
      evidence_path: payload.evidencePath,
    },
  })

  const mine = await listMyOperationalTasks(200)
  const mineTask = mine.find(item => item.id === payload.taskId)
  if (mineTask) return mineTask

  try {
    const supervised = await listSupervisorOperationalTasks(200)
    const supervisedTask = supervised.find(item => item.id === payload.taskId)
    if (supervisedTask) return supervisedTask
  } catch {
    // Expected for employee token (no supervision scope).
  }

  return { id: payload.taskId } as OperationalTask
}

export async function requestTaskManifestUpload(taskId: number) {
  const payload = await invokeEdge<TaskManageUploadResponse>("operational_tasks_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "request_manifest_upload",
      task_id: taskId,
    },
  })

  if (!payload) {
    throw new Error("Invalid evidence upload payload from backend.")
  }

  const token = payload.upload?.token
  const path = payload.upload?.path ?? payload.path
  const bucket = payload.bucket

  if (!token || !path || !bucket) {
    throw new Error("Invalid manifest upload payload from backend.")
  }

  return {
    token,
    path,
    bucket,
    requiredMime: payload.required_mime ?? "application/json",
  }
}

function resolveTaskUploadUrl(payload: TaskManageUploadResponse) {
  return payload.upload?.signedUrl ?? payload.upload_url ?? payload.signed_url ?? payload.url ?? null
}

function resolveTaskUploadPath(payload: TaskManageUploadResponse) {
  return payload.upload?.path ?? payload.path ?? null
}

function resolveTaskUploadToken(payload: TaskManageUploadResponse) {
  return payload.upload?.token ?? null
}

function resolveTaskUploadBucket(payload: TaskManageUploadResponse) {
  return payload.bucket ?? null
}

export async function requestTaskEvidenceUpload(taskId: number, mimeType: string) {
  const payload = await invokeEdge<TaskManageUploadResponse>("operational_tasks_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "request_evidence_upload",
      task_id: taskId,
      mime_type: mimeType,
    },
  })

  const path = resolveTaskUploadPath(payload)
  if (!path) {
    throw new Error("Invalid evidence upload payload from backend.")
  }

  return {
    path,
    bucket: resolveTaskUploadBucket(payload),
    token: resolveTaskUploadToken(payload),
    uploadUrl: resolveTaskUploadUrl(payload),
    headers: payload.headers ?? {},
  }
}

export async function uploadTaskManifestViaSignedToken(payload: {
  bucket: string
  path: string
  token: string
  file: Blob
}) {
  const { error } = await supabase.storage
    .from(payload.bucket)
    .uploadToSignedUrl(payload.path, payload.token, payload.file)

  if (error) throw error
}

export async function uploadTaskEvidenceViaSignedUrl(payload: {
  uploadUrl: string
  file: Blob
  headers?: Record<string, string>
}) {
  const response = await fetch(payload.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": payload.file.type || "application/octet-stream",
      ...(payload.headers ?? {}),
    },
    body: payload.file,
  })

  if (!response.ok) {
    throw new Error(`Could not upload task evidence (HTTP ${response.status}).`)
  }
}

import { supabase } from "@/services/supabaseClient"

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled"
export type TaskPriority = "low" | "normal" | "high" | "critical"

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

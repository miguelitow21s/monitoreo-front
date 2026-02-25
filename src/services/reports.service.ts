import { supabase } from "@/services/supabaseClient"
import { invokeEdge } from "@/services/edgeClient"
import { withRetry } from "@/utils/retry"

export type ReportColumnKey =
  | "shift_id"
  | "restaurant_id"
  | "employee_id"
  | "supervisor_id"
  | "start_time"
  | "end_time"
  | "status"
  | "duration"
  | "incidents"
  | "start_evidence"
  | "end_evidence"

export const REPORT_COLUMN_OPTIONS: Array<{ key: ReportColumnKey; label: string }> = [
  { key: "shift_id", label: "Turno" },
  { key: "restaurant_id", label: "Restaurante" },
  { key: "employee_id", label: "Empleado" },
  { key: "supervisor_id", label: "Supervisora" },
  { key: "start_time", label: "Inicio" },
  { key: "end_time", label: "Fin" },
  { key: "status", label: "Estado" },
  { key: "duration", label: "Duracion" },
  { key: "incidents", label: "Novedades" },
  { key: "start_evidence", label: "Evidencia inicio" },
  { key: "end_evidence", label: "Evidencia fin" },
]

export const DEFAULT_REPORT_COLUMNS: ReportColumnKey[] = [
  "shift_id",
  "restaurant_id",
  "employee_id",
  "start_time",
  "end_time",
  "status",
  "duration",
  "incidents",
]

export interface ReportRow {
  id: string
  restaurant_id: string | null
  employee_id: string | null
  supervisor_id: string | null
  start_time: string
  end_time: string | null
  status: string
  incidents_count: number
  duration_minutes: number | null
  start_evidence_path: string | null
  end_evidence_path: string | null
}

export interface ReportFilters {
  fromIso?: string
  toIso?: string
  restaurantId?: string
  employeeId?: string
  status?: string
}

export interface GeneratedReportHistory {
  id: string
  restaurant_id: string | null
  generated_at: string | null
  generated_by: string | null
  file_path: string | null
  hash_documento: string | null
  filtros_json: Record<string, unknown> | null
}

function normalizeReportHistoryRow(row: Record<string, unknown>): GeneratedReportHistory {
  return {
    id: String(row.id ?? ""),
    restaurant_id: row.restaurant_id ? String(row.restaurant_id) : null,
    generated_at:
      typeof row.generated_at === "string"
        ? row.generated_at
        : typeof row.created_at === "string"
          ? row.created_at
          : null,
    generated_by:
      typeof row.generado_por === "string"
        ? row.generado_por
        : typeof row.generated_by === "string"
          ? row.generated_by
          : null,
    file_path:
      typeof row.file_path === "string"
        ? row.file_path
        : typeof row.url === "string"
          ? row.url
          : null,
    hash_documento:
      typeof row.hash_documento === "string"
        ? row.hash_documento
        : typeof row.hash === "string"
          ? row.hash
          : null,
    filtros_json:
      typeof row.filtros_json === "object" && row.filtros_json !== null
        ? (row.filtros_json as Record<string, unknown>)
        : typeof row.filters_json === "object" && row.filters_json !== null
          ? (row.filters_json as Record<string, unknown>)
          : null,
  }
}

function buildDurationMinutes(startTime: string, endTime: string | null) {
  if (!endTime) return null
  const start = new Date(startTime).getTime()
  const end = new Date(endTime).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.floor((end - start) / 60000)
}

function formatDurationFromMinutes(durationMinutes: number | null) {
  if (durationMinutes === null || !Number.isFinite(durationMinutes) || durationMinutes < 0) return "-"
  const hours = Math.floor(durationMinutes / 60)
  const minutes = durationMinutes % 60
  return `${hours}h ${minutes}m`
}

function formatDateTime(value: string | null) {
  if (!value) return "-"
  return new Date(value).toLocaleString("es-CO")
}

export function getReportColumnValue(row: ReportRow, column: ReportColumnKey) {
  switch (column) {
    case "shift_id":
      return row.id
    case "restaurant_id":
      return row.restaurant_id ?? "-"
    case "employee_id":
      return row.employee_id ?? "-"
    case "supervisor_id":
      return row.supervisor_id ?? "-"
    case "start_time":
      return formatDateTime(row.start_time)
    case "end_time":
      return formatDateTime(row.end_time)
    case "status":
      return row.status
    case "duration":
      return formatDurationFromMinutes(row.duration_minutes)
    case "incidents":
      return String(row.incidents_count)
    case "start_evidence":
      return row.start_evidence_path ? "SI" : "NO"
    case "end_evidence":
      return row.end_evidence_path ? "SI" : "NO"
    default:
      return "-"
  }
}

export async function fetchShiftsReport(filters: ReportFilters = {}) {
  const { fromIso, toIso, restaurantId, employeeId, status } = filters

  return withRetry(async () => {
    let query = supabase
      .from("shifts")
      .select("id,restaurant_id,employee_id,start_time,end_time,status,start_evidence_path,end_evidence_path")
      .order("start_time", { ascending: false })

    if (fromIso) query = query.gte("start_time", fromIso)
    if (toIso) query = query.lte("start_time", toIso)
    if (restaurantId) query = query.eq("restaurant_id", restaurantId)
    if (employeeId) query = query.eq("employee_id", employeeId)
    if (status) query = query.eq("status", status)

    const { data, error } = await query.limit(500)
    if (error) throw error

    const baseRows = (data ?? []) as Array<{
      id: string | number
      restaurant_id: string | number | null
      employee_id: string | null
      start_time: string
      end_time: string | null
      status: string
      start_evidence_path: string | null
      end_evidence_path: string | null
    }>

    if (baseRows.length === 0) return [] as ReportRow[]

    const shiftIds = baseRows.map(item => item.id)
    const incidentCounter = new Map<string, number>()
    const supervisorByShift = new Map<string, string>()

    const [incidentsResult, scheduledResult] = await Promise.all([
      supabase.from("shift_incidents").select("shift_id").in("shift_id", shiftIds),
      supabase.from("scheduled_shifts").select("started_shift_id,created_by").in("started_shift_id", shiftIds),
    ])

    if (!incidentsResult.error) {
      for (const row of incidentsResult.data ?? []) {
        const shiftId = String(row.shift_id)
        incidentCounter.set(shiftId, (incidentCounter.get(shiftId) ?? 0) + 1)
      }
    }

    if (!scheduledResult.error) {
      for (const row of scheduledResult.data ?? []) {
        const shiftId = String(row.started_shift_id)
        if (!supervisorByShift.has(shiftId) && row.created_by) {
          supervisorByShift.set(shiftId, String(row.created_by))
        }
      }
    }

    return baseRows.map(item => {
      const shiftId = String(item.id)
      return {
        id: shiftId,
        restaurant_id: item.restaurant_id ? String(item.restaurant_id) : null,
        employee_id: item.employee_id,
        supervisor_id: supervisorByShift.get(shiftId) ?? null,
        start_time: item.start_time,
        end_time: item.end_time,
        status: item.status,
        incidents_count: incidentCounter.get(shiftId) ?? 0,
        duration_minutes: buildDurationMinutes(item.start_time, item.end_time),
        start_evidence_path: item.start_evidence_path,
        end_evidence_path: item.end_evidence_path,
      } satisfies ReportRow
    })
  })
}

export async function fetchGeneratedReportsHistory(limit = 20) {
  return withRetry(async () => {
    const preferred = await supabase
      .from("reports")
      .select("id,restaurant_id,generated_at,generado_por,file_path,hash_documento,filtros_json,created_at")
      .order("generated_at", { ascending: false, nullsFirst: false })
      .limit(limit)

    if (!preferred.error) {
      return (preferred.data ?? []).map(item =>
        normalizeReportHistoryRow(item as Record<string, unknown>)
      )
    }

    const fallback = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (fallback.error) throw fallback.error
    return (fallback.data ?? []).map(item => normalizeReportHistoryRow(item as Record<string, unknown>))
  })
}

export async function generateBackendReport(payload: {
  restaurantId: string
  periodStart: string
  periodEnd: string
}) {
  return invokeEdge("reports_generate", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      restaurant_id: Number(payload.restaurantId),
      period_start: payload.periodStart,
      period_end: payload.periodEnd,
    },
  })
}

export async function resolveReportReadonlyUrl(path: string | null | undefined, expiresInSeconds = 3600) {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path

  const buckets = ["reports", "shift-evidence", "evidence"]

  for (const bucket of buckets) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds)
    if (!error && data?.signedUrl) return data.signedUrl
  }

  return null
}

export function exportReportCsv(rows: ReportRow[], selectedColumns: ReportColumnKey[]) {
  const columns = selectedColumns.length > 0 ? selectedColumns : DEFAULT_REPORT_COLUMNS
  const header = columns.map(column => REPORT_COLUMN_OPTIONS.find(item => item.key === column)?.label ?? column)
  const lines = rows.map(row => columns.map(column => getReportColumnValue(row, column)))
  const csv = [header, ...lines]
    .map(line => line.map(value => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\n")

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `shift-report-${Date.now()}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

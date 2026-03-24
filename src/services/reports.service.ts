import { supabase } from "@/services/supabaseClient"
import { invokeEdge } from "@/services/edgeClient"
import { getEvidenceBucketCandidates } from "@/services/storageEvidence.service"
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
  { key: "shift_id", label: "Shift" },
  { key: "restaurant_id", label: "Restaurant" },
  { key: "employee_id", label: "Employee" },
  { key: "supervisor_id", label: "Supervisor" },
  { key: "start_time", label: "Start" },
  { key: "end_time", label: "End" },
  { key: "status", label: "Status" },
  { key: "duration", label: "Duration" },
  { key: "incidents", label: "Incidents" },
  { key: "start_evidence", label: "Start evidence" },
  { key: "end_evidence", label: "End evidence" },
]

export const DEFAULT_REPORT_COLUMNS: ReportColumnKey[] = [
  "shift_id",
  "restaurant_id",
  "employee_id",
  "supervisor_id",
  "start_time",
  "end_time",
  "status",
  "duration",
  "incidents",
  "start_evidence",
  "end_evidence",
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
  supervisorId?: string
  status?: string
  limit?: number
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

export interface GeneratedBackendReportResult {
  report_id: number
  generated_at: string | null
  file_path: string | null
  hash_documento: string | null
  url_pdf: string | null
  url_excel: string | null
  url_csv: string | null
}

export type BackendReportExportFormat = "csv" | "pdf" | "both"
export type BackendReportColumn =
  | "Turno"
  | "Restaurante"
  | "Empleado"
  | "Supervisora"
  | "Inicio"
  | "Fin"
  | "Estado"
  | "Duración"
  | "Novedades"
  | "Evidencia inicial"
  | "Evidencia final"

function toStringId(value: unknown) {
  if (typeof value === "string" && value.trim().length > 0) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null
}

function extractEvidencePath(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value
  if (Array.isArray(value)) {
    const fromString = value.find(item => typeof item === "string" && item.trim().length > 0) as string | undefined
    if (fromString) return fromString
    const fromObject = value.find(
      item =>
        item &&
        typeof item === "object" &&
        (typeof (item as { storage_path?: unknown }).storage_path === "string" ||
          typeof (item as { path?: unknown }).path === "string")
    ) as { storage_path?: string; path?: string } | undefined
    if (fromObject?.storage_path) return fromObject.storage_path
    if (fromObject?.path) return fromObject.path
  }
  if (value && typeof value === "object") {
    const candidate = value as { storage_path?: unknown; path?: unknown }
    if (typeof candidate.storage_path === "string") return candidate.storage_path
    if (typeof candidate.path === "string") return candidate.path
  }
  return null
}

function toNumberValue(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function unwrapItems(payload: unknown) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== "object") return [] as unknown[]
  const wrapped = payload as { items?: unknown }
  return Array.isArray(wrapped.items) ? wrapped.items : []
}

function normalizeReportRange(fromIso?: string, toIso?: string) {
  if (!fromIso || !toIso) return null
  const fromMs = Date.parse(fromIso)
  const toMs = Date.parse(toIso)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null
  if (fromMs >= toMs) return null
  return { from: fromIso, to: toIso }
}

function normalizeReportRow(raw: unknown): ReportRow | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const id = toStringId(row.id ?? row.shift_id)
  if (!id) return null

  const startTime = toNullableString(row.start_time)
  if (!startTime) return null

  const endTime = toNullableString(row.end_time)
  const durationRaw = row.duration_minutes ?? row.duration ?? null
  const durationMinutes =
    typeof durationRaw === "number" && Number.isFinite(durationRaw)
      ? durationRaw
      : typeof durationRaw === "string" && durationRaw.trim().length > 0 && Number.isFinite(Number(durationRaw))
        ? Number(durationRaw)
        : buildDurationMinutes(startTime, endTime)

  return {
    id,
    restaurant_id: toStringId(row.restaurant_id),
    employee_id: toNullableString(row.employee_id),
    supervisor_id: toNullableString(row.supervisor_id),
    start_time: startTime,
    end_time: endTime,
    status: typeof row.status === "string" ? row.status : "unknown",
    incidents_count: toNumberValue(row.incidents_count ?? row.incidents, 0),
    duration_minutes: durationMinutes,
    start_evidence_path: extractEvidencePath(
      row.start_evidence_path ??
        row.start_evidence ??
        row.start_evidence_paths ??
        row.start_evidences ??
        row.start_evidence_items
    ),
    end_evidence_path: extractEvidencePath(
      row.end_evidence_path ?? row.end_evidence ?? row.end_evidence_paths ?? row.end_evidences ?? row.end_evidence_items
    ),
  }
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
  return new Date(value).toLocaleString("en-US")
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
      return row.start_evidence_path ?? "-"
    case "end_evidence":
      return row.end_evidence_path ?? "-"
    default:
      return "-"
  }
}

export async function fetchShiftsReport(filters: ReportFilters = {}) {
  const { fromIso, toIso, restaurantId, employeeId, supervisorId, status } = filters
  const resultLimit = Math.max(1, Math.min(filters.limit ?? 500, 5000))
  const range = normalizeReportRange(fromIso, toIso)

  return withRetry(async () => {
    const payload = await invokeEdge<unknown>("reports_manage", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "list_shifts",
        ...(range ? { from: range.from, to: range.to } : {}),
        ...(restaurantId ? { restaurant_id: Number(restaurantId) } : {}),
        ...(employeeId ? { employee_id: employeeId } : {}),
        ...(supervisorId ? { supervisor_id: supervisorId } : {}),
        ...(status ? { status } : {}),
        limit: resultLimit,
      },
    })

    return unwrapItems(payload)
      .map(normalizeReportRow)
      .filter((row): row is ReportRow => row !== null)
  })
}

export async function fetchGeneratedReportsHistory(limit = 20) {
  return withRetry(async () => {
    const payload = await invokeEdge<unknown>("reports_manage", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "list_history",
        limit,
      },
    })

    return unwrapItems(payload)
      .map(item => normalizeReportHistoryRow(item as Record<string, unknown>))
  })
}

export async function generateBackendReport(payload: {
  restaurantId: string
  periodStart: string
  periodEnd: string
  exportFormat: BackendReportExportFormat
  columns: BackendReportColumn[]
}) {
  const raw = await invokeEdge<unknown>("reports_generate", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      restaurant_id: Number(payload.restaurantId),
      period_start: payload.periodStart,
      period_end: payload.periodEnd,
      export_format: payload.exportFormat,
      columns: payload.columns,
    },
  })

  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid backend report response.")
  }

  const row = raw as Record<string, unknown>
  return {
    report_id: Number(row.report_id ?? 0),
    generated_at: typeof row.generated_at === "string" ? row.generated_at : null,
    file_path: typeof row.file_path === "string" ? row.file_path : null,
    hash_documento: typeof row.hash_documento === "string" ? row.hash_documento : null,
    url_pdf: typeof row.url_pdf === "string" ? row.url_pdf : null,
    url_excel: typeof row.url_excel === "string" ? row.url_excel : null,
    url_csv: typeof row.url_csv === "string" ? row.url_csv : null,
  } satisfies GeneratedBackendReportResult
}

export async function resolveReportReadonlyUrl(path: string | null | undefined, expiresInSeconds = 3600) {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path

  const buckets = ["reports", ...getEvidenceBucketCandidates()]

  for (const bucket of buckets) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds)
    if (!error && data?.signedUrl) return data.signedUrl
  }

  return null
}

export function exportReportCsv(
  rows: ReportRow[],
  selectedColumns: ReportColumnKey[],
  getColumnLabel?: (column: ReportColumnKey) => string
) {
  const columns = selectedColumns.length > 0 ? selectedColumns : DEFAULT_REPORT_COLUMNS
  const header = columns.map(
    column => getColumnLabel?.(column) ?? REPORT_COLUMN_OPTIONS.find(item => item.key === column)?.label ?? column
  )
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

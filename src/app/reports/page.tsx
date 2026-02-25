"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { useToast } from "@/components/toast/ToastProvider"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import {
  DEFAULT_REPORT_COLUMNS,
  exportReportCsv,
  fetchGeneratedReportsHistory,
  fetchShiftsReport,
  GeneratedReportHistory,
  generateBackendReport,
  getReportColumnValue,
  REPORT_COLUMN_OPTIONS,
  ReportColumnKey,
  ReportRow,
  resolveReportReadonlyUrl,
} from "@/services/reports.service"
import { listRestaurants, Restaurant } from "@/services/restaurants.service"
import { listUserProfiles, UserProfile } from "@/services/users.service"
import { ROLES } from "@/utils/permissions"

function toStartOfDayIso(value: string) {
  if (!value) return undefined
  return new Date(`${value}T00:00:00`).toISOString()
}

function toEndOfDayIso(value: string) {
  if (!value) return undefined
  return new Date(`${value}T23:59:59`).toISOString()
}

function formatDateTime(value: string | null) {
  if (!value) return "-"
  return new Date(value).toLocaleString("es-CO")
}

function formatHistoryFilters(filters: Record<string, unknown> | null) {
  if (!filters) return "-"
  const entries = Object.entries(filters).filter(([, value]) => value !== null && value !== undefined && value !== "")
  if (entries.length === 0) return "-"
  return entries
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" | ")
}

const STATUS_OPTIONS = [
  { value: "", label: "Todos los estados" },
  { value: "active", label: "Activo" },
  { value: "completed", label: "Completado" },
  { value: "approved", label: "Aprobado" },
  { value: "rejected", label: "Rechazado" },
]

export default function ReportsPage() {
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [rows, setRows] = useState<ReportRow[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [employees, setEmployees] = useState<UserProfile[]>([])
  const [reportHistory, setReportHistory] = useState<GeneratedReportHistory[]>([])
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [restaurantId, setRestaurantId] = useState("")
  const [employeeId, setEmployeeId] = useState("")
  const [status, setStatus] = useState("")
  const [selectedColumns, setSelectedColumns] = useState<ReportColumnKey[]>(DEFAULT_REPORT_COLUMNS)
  const [generatingBackend, setGeneratingBackend] = useState(false)
  const [resolvingReportId, setResolvingReportId] = useState<string | null>(null)

  const employeeOptions = useMemo(
    () => employees.filter(item => item.role === ROLES.EMPLEADO && item.is_active !== false),
    [employees]
  )

  const visibleColumns = useMemo(() => {
    const selectedSet = new Set(selectedColumns)
    return REPORT_COLUMN_OPTIONS.filter(item => selectedSet.has(item.key))
  }, [selectedColumns])

  const loadCatalogs = useCallback(async () => {
    try {
      const [restaurantRows, profileRows] = await Promise.all([listRestaurants(), listUserProfiles()])
      setRestaurants(restaurantRows)
      setEmployees(profileRows)
    } catch {
      // Catalogos opcionales para filtros.
    }
  }, [])

  const loadReport = useCallback(async () => {
    setLoading(true)
    try {
      const reportRows = await fetchShiftsReport({
        fromIso: toStartOfDayIso(fromDate),
        toIso: toEndOfDayIso(toDate),
        restaurantId: restaurantId || undefined,
        employeeId: employeeId || undefined,
        status: status || undefined,
      })
      setRows(reportRows)
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudieron cargar los reportes.")
    } finally {
      setLoading(false)
    }
  }, [employeeId, fromDate, restaurantId, showToast, status, toDate])

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const rowsHistory = await fetchGeneratedReportsHistory(20)
      setReportHistory(rowsHistory)
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudo cargar historial de reportes.")
    } finally {
      setLoadingHistory(false)
    }
  }, [showToast])

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated || !session?.access_token) return
    void loadCatalogs()
  }, [authLoading, isAuthenticated, loadCatalogs, session?.access_token])

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated || !session?.access_token) return
    void loadReport()
    void loadHistory()
  }, [authLoading, isAuthenticated, loadHistory, loadReport, session?.access_token])

  const totalCompleted = useMemo(() => rows.filter(item => item.end_time).length, [rows])
  const totalActive = useMemo(() => rows.length - totalCompleted, [rows, totalCompleted])
  const totalIncidents = useMemo(
    () => rows.reduce((accumulator, item) => accumulator + (item.incidents_count ?? 0), 0),
    [rows]
  )

  const toggleColumn = (column: ReportColumnKey) => {
    setSelectedColumns(prev => {
      const hasColumn = prev.includes(column)
      if (hasColumn && prev.length === 1) {
        showToast("info", "Debes mantener al menos una columna seleccionada.")
        return prev
      }
      if (hasColumn) return prev.filter(item => item !== column)
      return [...prev, column]
    })
  }

  const resetFilters = () => {
    setFromDate("")
    setToDate("")
    setRestaurantId("")
    setEmployeeId("")
    setStatus("")
    setSelectedColumns(DEFAULT_REPORT_COLUMNS)
  }

  const exportPdf = () => {
    window.print()
  }

  const handleGenerateBackend = async () => {
    if (!restaurantId || !fromDate || !toDate) {
      showToast("info", "Para generar reporte backend debes seleccionar restaurante, fecha inicial y fecha final.")
      return
    }

    setGeneratingBackend(true)
    try {
      await generateBackendReport({
        restaurantId,
        periodStart: fromDate,
        periodEnd: toDate,
      })
      showToast("success", "Reporte generado en backend.")
      await loadHistory()
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudo generar reporte en backend.")
    } finally {
      setGeneratingBackend(false)
    }
  }

  const handleCopyReadonlyLink = async (report: GeneratedReportHistory) => {
    if (!report.file_path) {
      showToast("info", "Este reporte no incluye archivo enlazado.")
      return
    }

    setResolvingReportId(report.id)
    try {
      const signedUrl = await resolveReportReadonlyUrl(report.file_path)
      if (!signedUrl) {
        showToast("error", "No se pudo generar enlace de solo lectura.")
        return
      }
      await navigator.clipboard.writeText(signedUrl)
      showToast("success", "Enlace de solo lectura copiado.")
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudo copiar enlace.")
    } finally {
      setResolvingReportId(null)
    }
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN, ROLES.SUPERVISORA]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Reportes</h1>

          <Card
            title="Filtros y campos del reporte"
            subtitle="Configura rango, restaurante, empleado y datos incluidos en exportacion."
          >
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
              <input
                type="date"
                value={fromDate}
                onChange={event => setFromDate(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={toDate}
                onChange={event => setToDate(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={restaurantId}
                onChange={event => setRestaurantId(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Todos los restaurantes</option>
                {restaurants.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                value={employeeId}
                onChange={event => setEmployeeId(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Todos los empleados</option>
                {employeeOptions.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.full_name ?? item.email ?? item.id}
                  </option>
                ))}
              </select>
              <select
                value={status}
                onChange={event => setStatus(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {STATUS_OPTIONS.map(item => (
                  <option key={item.value || "all"} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => void loadReport()}>
                  Aplicar
                </Button>
                <Button variant="ghost" onClick={resetFilters}>
                  Limpiar
                </Button>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-700">Campos incluidos</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {REPORT_COLUMN_OPTIONS.map(item => (
                  <label key={item.key} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={selectedColumns.includes(item.key)}
                      onChange={() => toggleColumn(item.key)}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => exportReportCsv(rows, selectedColumns)}>
                  Exportar Excel (CSV)
                </Button>
                <Button variant="primary" onClick={exportPdf}>
                  Exportar PDF
                </Button>
                <Button variant="secondary" onClick={() => void handleGenerateBackend()} disabled={generatingBackend}>
                  {generatingBackend ? "Generando..." : "Generar en backend"}
                </Button>
              </div>
            </div>
          </Card>

          <Card title="Resumen" subtitle="Indicadores del filtro actual.">
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 p-3 text-sm">Turnos totales: {rows.length}</div>
              <div className="rounded-lg border border-slate-200 p-3 text-sm">Finalizados: {totalCompleted}</div>
              <div className="rounded-lg border border-slate-200 p-3 text-sm">Activos: {totalActive}</div>
              <div className="rounded-lg border border-slate-200 p-3 text-sm">Novedades: {totalIncidents}</div>
            </div>
          </Card>

          <Card title="Resultados del reporte" subtitle="Detalle con columnas seleccionadas.">
            {loading || authLoading ? (
              <Skeleton className="h-28" />
            ) : rows.length === 0 ? (
              <EmptyState
                title="Sin resultados"
                description="No hay filas para el filtro seleccionado."
                actionLabel="Reintentar"
                onAction={() => void loadReport()}
              />
            ) : (
              <div className="space-y-3">
                <div className="space-y-2 md:hidden">
                  {rows.map(item => (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                      {visibleColumns.map(column => (
                        <p key={`${item.id}-${column.key}`} className="mt-1 text-sm text-slate-700">
                          <span className="font-medium">{column.label}:</span>{" "}
                          {getReportColumnValue(item, column.key)}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        {visibleColumns.map(column => (
                          <th key={column.key} className="pb-2 pr-3">
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(item => (
                        <tr key={item.id} className="border-b border-slate-100">
                          {visibleColumns.map(column => (
                            <td key={`${item.id}-${column.key}`} className="py-2 pr-3">
                              {getReportColumnValue(item, column.key)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>

          <Card title="Historial de informes generados" subtitle="Registros historicos y enlace de solo lectura compartible.">
            {loadingHistory ? (
              <Skeleton className="h-24" />
            ) : reportHistory.length === 0 ? (
              <p className="text-sm text-slate-500">Aun no hay reportes generados registrados.</p>
            ) : (
              <div className="space-y-2">
                {reportHistory.map(report => (
                  <div key={report.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="font-medium text-slate-800">Reporte #{String(report.id).slice(0, 8)}</p>
                    <p className="text-slate-600">
                      Generado: {formatDateTime(report.generated_at)} | Restaurante: {report.restaurant_id ?? "-"}
                    </p>
                    <p className="text-slate-600">Generado por: {report.generated_by ?? "-"}</p>
                    <p className="text-xs text-slate-500">
                      Filtros: {formatHistoryFilters(report.filtros_json)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={resolvingReportId === report.id}
                        onClick={() => void handleCopyReadonlyLink(report)}
                      >
                        {resolvingReportId === report.id ? "Generando link..." : "Copiar enlace solo lectura"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}

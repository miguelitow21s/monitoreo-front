"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"
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
import { listMySupervisorRestaurants, listRestaurants, Restaurant } from "@/services/restaurants.service"
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

function formatHistoryFilters(filters: Record<string, unknown> | null) {
  if (!filters) return "-"
  const entries = Object.entries(filters).filter(([, value]) => value !== null && value !== undefined && value !== "")
  if (entries.length === 0) return "-"
  return entries
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" | ")
}

function toRestaurantShape(id: number, name: string): Restaurant {
  return {
    id: String(id),
    name,
    is_active: true,
    lat: null,
    lng: null,
    geofence_radius_m: null,
  }
}

const STATUS_OPTIONS = [
  { value: "", es: "Todos los estados", en: "All statuses" },
  { value: "active", es: "Activo", en: "Active" },
  { value: "completed", es: "Completado", en: "Completed" },
  { value: "approved", es: "Aprobado", en: "Approved" },
  { value: "rejected", es: "Rechazado", en: "Rejected" },
]

const COLUMN_LABELS: Record<ReportColumnKey, { es: string; en: string }> = {
  shift_id: { es: "Turno", en: "Shift" },
  restaurant_id: { es: "Restaurante", en: "Restaurant" },
  employee_id: { es: "Empleado", en: "Employee" },
  supervisor_id: { es: "Supervisora", en: "Supervisor" },
  start_time: { es: "Inicio", en: "Start" },
  end_time: { es: "Fin", en: "End" },
  status: { es: "Estado", en: "Status" },
  duration: { es: "Duracion", en: "Duration" },
  incidents: { es: "Novedades", en: "Incidents" },
  start_evidence: { es: "Evidencia inicial", en: "Start evidence" },
  end_evidence: { es: "Evidencia final", en: "End evidence" },
}

export default function ReportsPage() {
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { isSuperAdmin, isSupervisora } = useRole()
  const { formatDateTime, language, t } = useI18n()
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
  const [supervisorId, setSupervisorId] = useState("")
  const [status, setStatus] = useState("")
  const [selectedColumns, setSelectedColumns] = useState<ReportColumnKey[]>(DEFAULT_REPORT_COLUMNS)
  const [generatingBackend, setGeneratingBackend] = useState(false)
  const [resolvingReportId, setResolvingReportId] = useState<string | null>(null)
  const [reportLimit, setReportLimit] = useState(500)
  const [historyLimit, setHistoryLimit] = useState(20)

  const employeeOptions = useMemo(
    () => employees.filter(item => item.role === ROLES.EMPLEADO && item.is_active !== false),
    [employees]
  )

  const supervisorOptions = useMemo(
    () =>
      employees.filter(
        item => (item.role === ROLES.SUPERVISORA || item.role === ROLES.SUPER_ADMIN) && item.is_active !== false
      ),
    [employees]
  )

  const usersById = useMemo(() => new Map(employees.map(item => [item.id, item])), [employees])
  const restaurantsById = useMemo(
    () => new Map(restaurants.map(item => [String(item.id), item])),
    [restaurants]
  )

  const localizedColumnOptions = useMemo(
    () =>
      REPORT_COLUMN_OPTIONS.map(item => ({
        ...item,
        label: language === "en" ? COLUMN_LABELS[item.key].en : COLUMN_LABELS[item.key].es,
      })),
    [language]
  )

  const visibleColumns = useMemo(() => {
    const selectedSet = new Set(selectedColumns)
    return localizedColumnOptions.filter(item => selectedSet.has(item.key))
  }, [localizedColumnOptions, selectedColumns])

  const loadCatalogs = useCallback(async () => {
    try {
      const [restaurantRows, profileRows] = await Promise.all([
        isSupervisora
          ? listMySupervisorRestaurants().then(items => items.map(item => toRestaurantShape(item.id, item.name)))
          : listRestaurants(isSuperAdmin ? { useAdminApi: true } : undefined),
        listUserProfiles(isSuperAdmin ? { useAdminApi: true } : undefined),
      ])
      setRestaurants(restaurantRows)
      setEmployees(profileRows)
      if (isSupervisora) {
        setRestaurantId(prev => (prev && restaurantRows.some(item => item.id === prev) ? prev : restaurantRows[0]?.id ?? ""))
      }
    } catch {
      // Catalogos opcionales para filtros.
    }
  }, [isSuperAdmin, isSupervisora])

  const loadReport = useCallback(async () => {
    if (isSupervisora && !restaurantId) {
      setRows([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const reportRows = await fetchShiftsReport({
        fromIso: toStartOfDayIso(fromDate),
        toIso: toEndOfDayIso(toDate),
        restaurantId: restaurantId || undefined,
        employeeId: employeeId || undefined,
        supervisorId: supervisorId || undefined,
        status: status || undefined,
        limit: reportLimit,
      })
      setRows(reportRows)
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudieron cargar los reportes.", "Could not load reports."))
    } finally {
      setLoading(false)
    }
  }, [employeeId, fromDate, isSupervisora, reportLimit, restaurantId, showToast, status, supervisorId, t, toDate])

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const rowsHistory = await fetchGeneratedReportsHistory(historyLimit)
      setReportHistory(rowsHistory)
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo cargar historial de reportes.", "Could not load report history."))
    } finally {
      setLoadingHistory(false)
    }
  }, [historyLimit, showToast, t])

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated || !session?.access_token) return
    void loadCatalogs()
  }, [authLoading, isAuthenticated, loadCatalogs, session?.access_token])

  useEffect(() => {
    if (!isSupervisora) return
    if (restaurants.length === 0) {
      setRestaurantId("")
      return
    }
    setRestaurantId(prev => (prev && restaurants.some(item => item.id === prev) ? prev : restaurants[0]?.id ?? ""))
  }, [isSupervisora, restaurants])

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
        showToast("info", t("Debes mantener al menos una columna seleccionada.", "You must keep at least one selected column."))
        return prev
      }
      if (hasColumn) return prev.filter(item => item !== column)
      return [...prev, column]
    })
  }

  const resetFilters = () => {
    setFromDate("")
    setToDate("")
    setRestaurantId(isSupervisora ? restaurants[0]?.id ?? "" : "")
    setEmployeeId("")
    setSupervisorId("")
    setStatus("")
    setSelectedColumns(DEFAULT_REPORT_COLUMNS)
  }

  const getDisplayValue = useCallback(
    (row: ReportRow, column: ReportColumnKey) => {
      if (column === "restaurant_id") {
        const restaurant = row.restaurant_id ? restaurantsById.get(String(row.restaurant_id)) : null
        return restaurant?.name ?? (row.restaurant_id ?? "-")
      }
      if (column === "employee_id") {
        const employee = row.employee_id ? usersById.get(row.employee_id) : null
        return employee?.full_name ?? employee?.email ?? (row.employee_id ?? "-")
      }
      if (column === "supervisor_id") {
        const supervisor = row.supervisor_id ? usersById.get(row.supervisor_id) : null
        return supervisor?.full_name ?? supervisor?.email ?? (row.supervisor_id ?? "-")
      }
      return getReportColumnValue(row, column)
    },
    [restaurantsById, usersById]
  )

  const openEvidenceReadonly = useCallback(
    async (path: string | null | undefined) => {
      if (!path) {
        showToast("info", t("No hay evidencia asociada.", "No linked evidence."))
        return
      }

      const signedUrl = await resolveReportReadonlyUrl(path)
      if (!signedUrl) {
        showToast("error", t("No se pudo generar enlace de evidencia.", "Could not generate evidence link."))
        return
      }

      window.open(signedUrl, "_blank", "noopener,noreferrer")
    },
    [showToast, t]
  )

  const handleExportCsv = useCallback(() => {
    const exportRows = rows.map(item => ({
      ...item,
      restaurant_id: getDisplayValue(item, "restaurant_id"),
      employee_id: getDisplayValue(item, "employee_id"),
      supervisor_id: getDisplayValue(item, "supervisor_id"),
    }))
    exportReportCsv(exportRows, selectedColumns, key =>
      language === "en" ? COLUMN_LABELS[key].en : COLUMN_LABELS[key].es
    )
  }, [getDisplayValue, language, rows, selectedColumns])

  const exportPdf = () => {
    window.print()
  }

  const handleGenerateBackend = async () => {
    if (!restaurantId || !fromDate || !toDate) {
      showToast("info", t("Para generar reporte backend debes seleccionar restaurante, fecha inicial y fecha final.", "To generate backend report you must select restaurant, start date, and end date."))
      return
    }

    setGeneratingBackend(true)
    try {
      const generated = await generateBackendReport({
        restaurantId,
        periodStart: fromDate,
        periodEnd: toDate,
      })
      showToast("success", t("Reporte generado en backend.", "Report generated in backend."))
      if (generated.url_pdf) {
        window.open(generated.url_pdf, "_blank", "noopener,noreferrer")
      }
      if (generated.url_excel) {
        window.open(generated.url_excel, "_blank", "noopener,noreferrer")
      }
      await loadHistory()
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo generar reporte en backend.", "Could not generate report in backend."))
    } finally {
      setGeneratingBackend(false)
    }
  }

  const handleCopyReadonlyLink = async (report: GeneratedReportHistory) => {
    if (!report.file_path) {
      showToast("info", t("Este reporte no incluye archivo enlazado.", "This report does not include a linked file."))
      return
    }

    setResolvingReportId(report.id)
    try {
      const signedUrl = await resolveReportReadonlyUrl(report.file_path)
      if (!signedUrl) {
        showToast("error", t("No se pudo generar enlace de solo lectura.", "Could not generate read-only link."))
        return
      }
      await navigator.clipboard.writeText(signedUrl)
      showToast("success", t("Enlace de solo lectura copiado.", "Read-only link copied."))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo copiar enlace.", "Could not copy link."))
    } finally {
      setResolvingReportId(null)
    }
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN, ROLES.SUPERVISORA]}>
        <div className="space-y-5">
          <h1 className="text-2xl font-bold text-slate-900">{t("Reportes", "Reports")}</h1>

          <Card
            title={t("Filtros del reporte", "Report filters")}
          >
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                {!isSupervisora && (
                  <option value="">{t("Todos los clientes/restaurantes", "All clients/restaurants")}</option>
                )}
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
                <option value="">{t("Todos los empleados", "All employees")}</option>
                {employeeOptions.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.full_name ?? item.email ?? item.id}
                  </option>
                ))}
              </select>
              <select
                value={supervisorId}
                onChange={event => setSupervisorId(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">{t("Todas las supervisoras", "All supervisors")}</option>
                {supervisorOptions.map(item => (
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
                    {language === "en" ? item.en : item.es}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void loadReport()}>
                  {t("Aplicar", "Apply")}
                </Button>
                <Button variant="ghost" onClick={resetFilters}>
                  {t("Limpiar", "Reset")}
                </Button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>{t("Max filas", "Max rows")}: {reportLimit}</span>
              <Button size="sm" variant="ghost" onClick={() => setReportLimit(prev => Math.min(prev + 500, 5000))}>
                {t("Cargar mas filas", "Load more rows")}
              </Button>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-700">{t("Campos incluidos", "Included fields")}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {localizedColumnOptions.map(item => (
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
                <Button variant="ghost" onClick={handleExportCsv} className="sm:w-auto">
                  {t("Exportar Excel (CSV)", "Export Excel (CSV)")}
                </Button>
                <Button variant="primary" onClick={exportPdf} className="sm:w-auto">
                  {t("Exportar PDF", "Export PDF")}
                </Button>
                <Button variant="secondary" onClick={() => void handleGenerateBackend()} disabled={generatingBackend} className="sm:w-auto">
                  {generatingBackend ? t("Generando...", "Generating...") : t("Generar en backend", "Generate in backend")}
                </Button>
              </div>
            </div>
          </Card>

          <Card title={t("Resumen", "Summary")}>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">{t("Turnos totales", "Total shifts")}: {rows.length}</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">{t("Finalizados", "Completed")}: {totalCompleted}</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">{t("Activos", "Active")}: {totalActive}</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">{t("Novedades", "Incidents")}: {totalIncidents}</div>
            </div>
          </Card>

          <Card title={t("Resultados del reporte", "Report results")}>
            {loading || authLoading ? (
              <Skeleton className="h-28" />
            ) : rows.length === 0 ? (
              <EmptyState
                title={t("Sin resultados", "No results")}
                description={t("No hay filas para el filtro seleccionado.", "No rows for selected filter.")}
                actionLabel={t("Reintentar", "Retry")}
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
                          {column.key === "start_evidence" || column.key === "end_evidence" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                void openEvidenceReadonly(
                                  column.key === "start_evidence" ? item.start_evidence_path : item.end_evidence_path
                                )
                              }
                            >
                              {column.key === "start_evidence"
                                ? t("Ver foto inicial", "View start photo")
                                : t("Ver foto final", "View end photo")}
                            </Button>
                          ) : (
                            getDisplayValue(item, column.key)
                          )}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
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
                              {column.key === "start_evidence" || column.key === "end_evidence" ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() =>
                                    void openEvidenceReadonly(
                                      column.key === "start_evidence" ? item.start_evidence_path : item.end_evidence_path
                                    )
                                  }
                                >
                                  {column.key === "start_evidence"
                                    ? t("Ver foto inicial", "View start photo")
                                    : t("Ver foto final", "View end photo")}
                                </Button>
                              ) : (
                                getDisplayValue(item, column.key)
                              )}
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

          <Card title={t("Historial de informes generados", "Generated reports history")}>
            {loadingHistory ? (
              <Skeleton className="h-24" />
            ) : reportHistory.length === 0 ? (
              <p className="text-sm text-slate-500">{t("Aun no hay reportes generados registrados.", "No generated reports recorded yet.")}</p>
            ) : (
              <div className="space-y-2">
                {reportHistory.map(report => (
                  <div key={report.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="font-medium text-slate-800">{t("Reporte", "Report")} #{String(report.id).slice(0, 8)}</p>
                    <p className="text-slate-600">
                      {t("Generado", "Generated")}: {formatDateTime(report.generated_at)} | {t("Restaurante", "Restaurant")}: {report.restaurant_id ?? "-"}
                    </p>
                    <p className="text-slate-600">{t("Generado por", "Generated by")}: {report.generated_by ?? "-"}</p>
                    <p className="text-xs text-slate-500">
                      {t("Filtros", "Filters")}: {formatHistoryFilters(report.filtros_json)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={resolvingReportId === report.id}
                        onClick={() => void handleCopyReadonlyLink(report)}
                      >
                        {resolvingReportId === report.id ? t("Generando link...", "Generating link...") : t("Copiar enlace solo lectura", "Copy read-only link")}
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="pt-2">
                  <Button size="sm" variant="ghost" onClick={() => setHistoryLimit(prev => Math.min(prev + 20, 500))}>
                    {t("Cargar mas historial", "Load more history")}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}

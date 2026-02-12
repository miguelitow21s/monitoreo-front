"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { useToast } from "@/components/toast/ToastProvider"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import { exportReportCsv, fetchShiftsReport, ReportRow } from "@/services/reports.service"
import { listRestaurants, Restaurant } from "@/services/restaurants.service"
import { ROLES } from "@/utils/permissions"

function toStartOfDayIso(value: string) {
  if (!value) return undefined
  return new Date(`${value}T00:00:00`).toISOString()
}

function toEndOfDayIso(value: string) {
  if (!value) return undefined
  return new Date(`${value}T23:59:59`).toISOString()
}

export default function ReportsPage() {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ReportRow[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [restaurantId, setRestaurantId] = useState("")

  const loadCatalogs = useCallback(async () => {
    try {
      const items = await listRestaurants()
      setRestaurants(items)
    } catch {
      // optional
    }
  }, [])

  const loadReport = useCallback(async () => {
    setLoading(true)
    try {
      const reportRows = await fetchShiftsReport(
        toStartOfDayIso(fromDate),
        toEndOfDayIso(toDate),
        restaurantId || undefined
      )
      setRows(reportRows)
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudo cargar reportes.")
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate, restaurantId, showToast])

  useEffect(() => {
    void loadCatalogs()
  }, [loadCatalogs])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  const totalCompleted = useMemo(() => rows.filter(item => item.end_time).length, [rows])
  const totalActive = useMemo(() => rows.length - totalCompleted, [rows, totalCompleted])

  const exportPdf = () => {
    window.print()
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN, ROLES.SUPERVISORA]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Reportes</h1>

          <Card title="Filtros del reporte" subtitle="Consulta por rango de fechas y restaurante.">
            <div className="mt-3 grid gap-2 md:grid-cols-5">
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
              <Button variant="secondary" onClick={() => void loadReport()}>
                Aplicar
              </Button>
              <Button variant="ghost" onClick={() => exportReportCsv(rows)}>
                Exportar Excel (CSV)
              </Button>
            </div>
          </Card>

          <Card title="Resumen" subtitle="Indicadores del filtro actual.">
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 p-3 text-sm">Total turnos: {rows.length}</div>
              <div className="rounded-lg border border-slate-200 p-3 text-sm">Finalizados: {totalCompleted}</div>
              <div className="rounded-lg border border-slate-200 p-3 text-sm">Activos: {totalActive}</div>
            </div>
            <div className="mt-3">
              <Button variant="primary" onClick={exportPdf}>
                Exportar PDF
              </Button>
            </div>
          </Card>

          <Card title="Resultado del reporte" subtitle="Enlaces de solo lectura por registro.">
            {loading ? (
              <Skeleton className="h-28" />
            ) : rows.length === 0 ? (
              <EmptyState
                title="Sin resultados"
                description="No hay filas para el filtro seleccionado."
                actionLabel="Reintentar"
                onAction={() => void loadReport()}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-2 pr-3">Turno</th>
                      <th className="pb-2 pr-3">Restaurante</th>
                      <th className="pb-2 pr-3">Inicio</th>
                      <th className="pb-2 pr-3">Fin</th>
                      <th className="pb-2 pr-3">Estado</th>
                      <th className="pb-2 pr-3">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(item => (
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className="py-2 pr-3">{item.id.slice(0, 8)}</td>
                        <td className="py-2 pr-3">{item.restaurant_id ?? "-"}</td>
                        <td className="py-2 pr-3">{new Date(item.start_time).toLocaleString("es-CO")}</td>
                        <td className="py-2 pr-3">
                          {item.end_time ? new Date(item.end_time).toLocaleString("es-CO") : "-"}
                        </td>
                        <td className="py-2 pr-3">{item.status}</td>
                        <td className="py-2 pr-3">
                          <span className="text-xs text-slate-500">Solo lectura</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}

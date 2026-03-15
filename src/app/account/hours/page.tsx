"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import { useToast } from "@/components/toast/ToastProvider"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"
import { EmployeeHoursHistoryRow, getEmployeeHoursHistory } from "@/services/employeeSelfService.service"
import { ROLES } from "@/utils/permissions"

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoIsoDate(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

export default function AccountHoursPage() {
  const { t, formatDateTime } = useI18n()
  const { showToast } = useToast()
  const { isEmpleado, loading: roleLoading } = useRole()
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [rows, setRows] = useState<EmployeeHoursHistoryRow[]>([])
  const [totalHours, setTotalHours] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (roleLoading || !isEmpleado) {
      setLoading(false)
      return
    }

    if (!from || !to) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const result = await getEmployeeHoursHistory({
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59`).toISOString(),
      })
      setRows(result.items)
      setTotalHours(result.totalHours)
    } catch (error: unknown) {
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : t("No se pudo cargar historial de horas.", "Could not load worked-hours history.")
      )
    } finally {
      setLoading(false)
    }
  }, [from, isEmpleado, roleLoading, showToast, t, to])

  useEffect(() => {
    if (!from && !to) {
      setFrom(daysAgoIsoDate(30))
      setTo(todayIsoDate())
    }
  }, [from, to])

  useEffect(() => {
    if (roleLoading || !isEmpleado) return
    void load()
  }, [isEmpleado, load, roleLoading])

  const fallbackTotalHours = useMemo(() => {
    if (totalHours > 0) return totalHours
    return rows.reduce((acc, row) => {
      if (typeof row.worked_hours === "number") return acc + row.worked_hours
      if (typeof row.worked_minutes === "number") return acc + row.worked_minutes / 60
      if (!row.start_time || !row.end_time) return acc
      const start = new Date(row.start_time).getTime()
      const end = new Date(row.end_time).getTime()
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return acc
      return acc + (end - start) / 3600000
    }, 0)
  }, [rows, totalHours])

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.EMPLEADO]}>
        <section className="space-y-4">
          <Card title={t("Historial de horas", "Hours history")}>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <input
                type="date"
                value={from}
                onChange={event => setFrom(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={to}
                onChange={event => setTo(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <Button variant="secondary" onClick={() => void load()}>
                {t("Actualizar", "Refresh")}
              </Button>
            </div>

            <p className="mt-3 text-sm text-slate-700">
              {t("Total horas del periodo", "Total period hours")}: <span className="font-semibold">{fallbackTotalHours.toFixed(2)}h</span>
            </p>
          </Card>

          <Card title={t("Detalle", "Details")}>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-10" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                title={t("Sin registros", "No records")}
                description={t("No hay horas registradas en el rango seleccionado.", "No worked hours found for the selected range.")}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="px-3 py-2">{t("Inicio", "Start")}</th>
                      <th className="px-3 py-2">{t("Fin", "End")}</th>
                      <th className="px-3 py-2">{t("Restaurante", "Restaurant")}</th>
                      <th className="px-3 py-2">{t("Horas", "Hours")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item, index) => {
                      const workedHours =
                        typeof item.worked_hours === "number"
                          ? item.worked_hours
                          : typeof item.worked_minutes === "number"
                            ? item.worked_minutes / 60
                            : 0

                      return (
                        <tr key={`${item.shift_id ?? "shift"}-${index}`} className="border-b border-slate-100">
                          <td className="px-3 py-2">{formatDateTime(item.start_time ?? null)}</td>
                          <td className="px-3 py-2">{formatDateTime(item.end_time ?? null)}</td>
                          <td className="px-3 py-2">#{item.restaurant_id ?? "-"}</td>
                          <td className="px-3 py-2">{workedHours.toFixed(2)}h</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      </RoleGuard>
    </ProtectedRoute>
  )
}

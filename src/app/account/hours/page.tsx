"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Manrope } from "next/font/google"

import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import { useToast } from "@/components/toast/ToastProvider"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"
import { EmployeeHoursHistoryRow, getEmployeeHoursHistory } from "@/services/employeeSelfService.service"
import { ROLES } from "@/utils/permissions"

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
})

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

  const rangeLabel = from && to ? `${from} → ${to}` : t("Sin rango", "No range")

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.EMPLEADO]}>
        <section className={`space-y-5 ${manrope.className}`}>
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 px-6 py-6 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100">
                {t("Control de horas", "Hours control")}
              </p>
              <h1 className="mt-2 text-2xl font-extrabold">{t("Historial de horas", "Hours history")}</h1>
              <p className="mt-1 text-sm text-blue-100">
                {t("Consulta tu actividad por rango de fechas.", "Review your work by date range.")}
              </p>
            </div>

            <div className="grid gap-3 px-6 py-6 sm:grid-cols-[1fr,1fr,auto]">
              <input
                type="date"
                value={from}
                onChange={event => setFrom(event.target.value)}
                className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500"
              />
              <input
                type="date"
                value={to}
                onChange={event => setTo(event.target.value)}
                className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500"
              />
              <Button
                variant="primary"
                onClick={() => void load()}
                className="h-11 rounded-2xl px-6 text-sm"
              >
                {t("Actualizar", "Refresh")}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-6 py-4 text-sm">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {t("Total", "Total")}
                </p>
                <p className="text-lg font-extrabold text-slate-900">{fallbackTotalHours.toFixed(2)}h</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
                {t("Rango", "Range")}: {rangeLabel}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
                {t("Registros", "Records")}: {rows.length}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {t("Detalle", "Details")}
              </p>
              <span className="text-xs text-slate-500">{t("Registro por turno", "Shift-by-shift record")}</span>
            </div>

            <div className="mt-4">
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
                <>
                  <div className="grid gap-3 md:hidden">
                    {rows.map((item, index) => {
                      const workedHours =
                        typeof item.worked_hours === "number"
                          ? item.worked_hours
                          : typeof item.worked_minutes === "number"
                            ? item.worked_minutes / 60
                            : 0

                      return (
                        <div
                          key={`${item.shift_id ?? "shift"}-${index}`}
                          className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-sm text-slate-700"
                        >
                          <p className="text-xs text-slate-500">{t("Inicio", "Start")}</p>
                          <p className="font-semibold">{formatDateTime(item.start_time ?? null)}</p>
                          <p className="mt-2 text-xs text-slate-500">{t("Fin", "End")}</p>
                          <p className="font-semibold">{formatDateTime(item.end_time ?? null)}</p>
                          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                            <span>#{item.restaurant_id ?? "-"}</span>
                            <span className="font-semibold text-slate-800">{workedHours.toFixed(2)}h</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 md:block">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.08em] text-slate-500">
                          <th className="px-4 py-3">{t("Inicio", "Start")}</th>
                          <th className="px-4 py-3">{t("Fin", "End")}</th>
                          <th className="px-4 py-3">{t("Restaurante", "Restaurant")}</th>
                          <th className="px-4 py-3">{t("Horas", "Hours")}</th>
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
                              <td className="px-4 py-3">{formatDateTime(item.start_time ?? null)}</td>
                              <td className="px-4 py-3">{formatDateTime(item.end_time ?? null)}</td>
                              <td className="px-4 py-3">#{item.restaurant_id ?? "-"}</td>
                              <td className="px-4 py-3 font-semibold text-slate-800">{workedHours.toFixed(2)}h</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </RoleGuard>
    </ProtectedRoute>
  )
}

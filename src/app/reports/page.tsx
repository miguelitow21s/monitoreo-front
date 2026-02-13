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
      showToast("error", error instanceof Error ? error.message : "Could not load reports.")
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
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>

          <Card title="Report filters" subtitle="Filter by date range and restaurant.">
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
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
                <option value="">All restaurants</option>
                {restaurants.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => void loadReport()}>
                Apply
              </Button>
              <Button variant="ghost" onClick={() => exportReportCsv(rows)}>
                Export Excel (CSV)
              </Button>
            </div>
          </Card>

          <Card title="Summary" subtitle="Current filter indicators.">
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 p-3 text-sm">Total shifts: {rows.length}</div>
              <div className="rounded-lg border border-slate-200 p-3 text-sm">Completed: {totalCompleted}</div>
              <div className="rounded-lg border border-slate-200 p-3 text-sm">Active: {totalActive}</div>
            </div>
            <div className="mt-3">
              <Button variant="primary" onClick={exportPdf}>
                Export PDF
              </Button>
            </div>
          </Card>

          <Card title="Report results" subtitle="Read-only row details.">
            {loading ? (
              <Skeleton className="h-28" />
            ) : rows.length === 0 ? (
              <EmptyState
                title="No results"
                description="No rows for the selected filter."
                actionLabel="Retry"
                onAction={() => void loadReport()}
              />
            ) : (
              <div className="space-y-3">
                <div className="space-y-2 md:hidden">
                  {rows.map(item => (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Shift {String(item.id).slice(0, 8)}</p>
                      <p className="mt-1 text-sm text-slate-700">Restaurant: {item.restaurant_id ?? "-"}</p>
                      <p className="mt-1 text-sm text-slate-700">
                        Start: {new Date(item.start_time).toLocaleString("en-US")}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        End: {item.end_time ? new Date(item.end_time).toLocaleString("en-US") : "-"}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">Status: {item.status}</p>
                    </div>
                  ))}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="pb-2 pr-3">Shift</th>
                        <th className="pb-2 pr-3">Restaurant</th>
                        <th className="pb-2 pr-3">Start</th>
                        <th className="pb-2 pr-3">End</th>
                        <th className="pb-2 pr-3">Status</th>
                        <th className="pb-2 pr-3">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(item => (
                        <tr key={item.id} className="border-b border-slate-100">
                          <td className="py-2 pr-3">{String(item.id).slice(0, 8)}</td>
                          <td className="py-2 pr-3">{item.restaurant_id ?? "-"}</td>
                          <td className="py-2 pr-3">{new Date(item.start_time).toLocaleString("en-US")}</td>
                          <td className="py-2 pr-3">
                            {item.end_time ? new Date(item.end_time).toLocaleString("en-US") : "-"}
                          </td>
                          <td className="py-2 pr-3">{item.status}</td>
                          <td className="py-2 pr-3">
                            <span className="text-xs text-slate-500">Read only</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}

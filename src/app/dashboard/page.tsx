"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import ProtectedRoute from "@/components/ProtectedRoute"
import { useToast } from "@/components/toast/ToastProvider"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"
import { AuditEvent, DashboardMetric, fetchAuditEvents, fetchDashboardMetrics } from "@/services/dashboard.service"
import { EmployeeDashboardData, getEmployeeSelfDashboard } from "@/services/employeeSelfService.service"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"

export default function DashboardPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const { formatDateTime, t } = useI18n()
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { loading, isEmpleado, isSupervisora, isSuperAdmin } = useRole()

  const [metrics, setMetrics] = useState<DashboardMetric[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [employeeHome, setEmployeeHome] = useState<EmployeeDashboardData | null>(null)

  const roleSummary = isSuperAdmin
    ? t("Vista completa del sistema para administracion global.", "Full system view for global administration.")
    : isSupervisora
      ? t("Supervision en tiempo real de turnos e insumos.", "Real-time supervision of shifts and supplies.")
      : t("Control personal de asistencia y evidencia de turnos.", "Personal attendance control and shift evidence.")

  const quickActions = useMemo(
    () => [
      { label: t("Ver turnos de hoy", "View today's shifts"), onClick: () => router.push("/shifts"), variant: "primary" as const },
      {
        label: t("Revisar novedades", "Review incidents"),
        onClick: () => router.push("/shifts"),
        variant: "secondary" as const,
      },
      ...(isSuperAdmin
        ? [{ label: t("Gestionar usuarios", "Manage users"), onClick: () => router.push("/users"), variant: "ghost" as const }]
        : []),
    ],
    [isSuperAdmin, router, t]
  )

  const loadData = useCallback(async () => {
    setLoadingData(true)
    try {
      const [metricRows, auditRows] = await Promise.all([
        fetchDashboardMetrics({ useAdminApi: isSuperAdmin }),
        isSuperAdmin || isSupervisora ? fetchAuditEvents(10) : Promise.resolve([] as AuditEvent[]),
      ])
      setMetrics(metricRows)
      setAuditEvents(auditRows)

      if (isEmpleado) {
        const home = await getEmployeeSelfDashboard()
        setEmployeeHome(home)
      } else {
        setEmployeeHome(null)
      }
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo cargar el panel.", "Could not load dashboard."))
    } finally {
      setLoadingData(false)
    }
  }, [showToast, isEmpleado, isSuperAdmin, isSupervisora, t])

  useEffect(() => {
    if (loading || authLoading) return
    if (!isAuthenticated || !session?.access_token) return
    void loadData()
  }, [loading, authLoading, isAuthenticated, session?.access_token, loadData])

  const localizedMetrics = useMemo(
    () =>
      metrics.map(metric => {
        const labelMap: Record<string, { es: string; en: string }> = {
          "Active shifts": { es: "Turnos activos", en: "Active shifts" },
          Compliance: { es: "Cumplimiento", en: "Compliance" },
          Incidents: { es: "Novedades", en: "Incidents" },
          "Avg shift duration": { es: "Duracion promedio", en: "Avg shift duration" },
          "Estimated supply cost": { es: "Costo estimado insumos", en: "Estimated supply cost" },
          "Monitored sites": { es: "Sitios monitoreados", en: "Monitored sites" },
        }
        const trendMap: Record<string, { es: string; en: string }> = {
          "Real-time updates": { es: "Actualizacion en tiempo real", en: "Real-time updates" },
          "Closed shifts vs total": { es: "Turnos cerrados vs total", en: "Closed shifts vs total" },
          "Accumulated operational reports": { es: "Reportes operativos acumulados", en: "Accumulated operational reports" },
          "Productivity baseline": { es: "Linea base de productividad", en: "Productivity baseline" },
          "Deliveries x unit cost": { es: "Entregas x costo unitario", en: "Deliveries x unit cost" },
          "Total registered coverage": { es: "Cobertura total registrada", en: "Total registered coverage" },
        }

        return {
          ...metric,
          label: labelMap[metric.label] ? t(labelMap[metric.label].es, labelMap[metric.label].en) : metric.label,
          trend: trendMap[metric.trend] ? t(trendMap[metric.trend].es, trendMap[metric.trend].en) : metric.trend,
        }
      }),
    [metrics, t]
  )

  return (
    <ProtectedRoute>
      <section className="space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{t("Panel operativo", "Operations dashboard")}</h1>
          <p className="mt-1 text-sm text-slate-600">{roleSummary}</p>
        </div>

        {loading || authLoading || loadingData ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Skeleton className="h-56 lg:col-span-2" />
              <Skeleton className="h-56" />
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {localizedMetrics.map(metric => (
                <Card
                  key={metric.label}
                  title={metric.label}
                  value={metric.value}
                  trend={metric.trend}
                  variant="stat"
                />
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={t("Acciones rapidas", "Quick actions")}>
                <div className="mt-4 space-y-2">
                  {quickActions.map(action => (
                    <Button
                      key={action.label}
                      fullWidth
                      variant={action.variant}
                      onClick={action.onClick}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              </Card>

              <Card title={t("Estado", "Status")}>
                <p className="text-sm text-slate-700">
                  {isSuperAdmin || isSupervisora
                    ? t("Supervision habilitada.", "Supervision enabled.")
                    : t("Vista de empleado activa.", "Employee view active.")}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {t("Eventos recientes", "Recent events")}: {auditEvents.length}
                </p>
              </Card>
            </div>

            {isEmpleado && employeeHome && (
              <Card title={t("Mi inicio", "My home")}>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="text-xs text-slate-500">{t("Restaurantes", "Restaurants")}</p>
                    <p className="font-semibold text-slate-800">{employeeHome.assigned_restaurants?.length ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="text-xs text-slate-500">{t("Agenda", "Schedule")}</p>
                    <p className="font-semibold text-slate-800">{employeeHome.scheduled_shifts?.length ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="text-xs text-slate-500">{t("Tareas abiertas", "Open tasks")}</p>
                    <p className="font-semibold text-slate-800">{employeeHome.pending_tasks_count ?? employeeHome.pending_tasks_preview?.length ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="text-xs text-slate-500">{t("Turno activo", "Active shift")}</p>
                    <p className="font-semibold text-slate-800">#{employeeHome.active_shift?.id ?? "-"}</p>
                  </div>
                </div>
              </Card>
            )}

            {auditEvents.length === 0 ? (
              <EmptyState
                title={t("Sin eventos de auditoria", "No audit events")}
                description={t("No hay actividad reciente para mostrar.", "No recent activity to show.")}
                actionLabel={t("Actualizar panel", "Refresh dashboard")}
                onAction={() => void loadData()}
              />
            ) : (
              <Card title={t("Linea de tiempo de auditoria", "Audit timeline")}>
                <ul className="space-y-2 text-sm text-slate-700">
                  {auditEvents.map(item => (
                      <li key={item.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
                        <p className="font-medium">{item.action}</p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(item.created_at)} | {t("Actor", "Actor")}: {item.actor_id ?? t("sistema", "system")}
                        </p>
                      </li>
                  ))}
                </ul>
              </Card>
            )}

            {isEmpleado && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                {t("Revisa tus turnos activos y finalizalos con evidencia de salida.", "Review your active shifts and close them with exit evidence.")}
              </div>
            )}
          </>
        )}
      </section>
    </ProtectedRoute>
  )
}

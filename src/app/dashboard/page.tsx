"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import ProtectedRoute from "@/components/ProtectedRoute"
import { useToast } from "@/components/toast/ToastProvider"
import { useAuth } from "@/hooks/useAuth"
import { useRole } from "@/hooks/useRole"
import { AuditEvent, DashboardMetric, fetchAuditEvents, fetchDashboardMetrics } from "@/services/dashboard.service"
import {
  IntegrationCheckResult,
  runBackendIntegrationChecks,
} from "@/services/integrationChecks.service"
import Badge from "@/components/ui/Badge"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-CO")
}

export default function DashboardPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { loading, isEmpleado, isSupervisora, isSuperAdmin } = useRole()

  const [metrics, setMetrics] = useState<DashboardMetric[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [runningChecks, setRunningChecks] = useState(false)
  const [checkResults, setCheckResults] = useState<IntegrationCheckResult[]>([])

  const roleSummary = isSuperAdmin
    ? "Vista completa del sistema para administracion global."
    : isSupervisora
      ? "Supervision en tiempo real de turnos e insumos."
      : "Control personal de asistencia y evidencia de turnos."

  const quickActions = useMemo(
    () => [
      { label: "Ver turnos de hoy", onClick: () => router.push("/shifts"), variant: "primary" as const },
      {
        label: "Revisar novedades",
        onClick: () => router.push("/shifts"),
        variant: "secondary" as const,
      },
      ...(isSuperAdmin
        ? [{ label: "Gestionar usuarios", onClick: () => router.push("/users"), variant: "ghost" as const }]
        : []),
    ],
    [isSuperAdmin, router]
  )

  const loadData = useCallback(async () => {
    setLoadingData(true)
    try {
      const [metricRows, auditRows] = await Promise.all([
        fetchDashboardMetrics(),
        isSuperAdmin || isSupervisora ? fetchAuditEvents(10) : Promise.resolve([] as AuditEvent[]),
      ])
      setMetrics(metricRows)
      setAuditEvents(auditRows)
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudo cargar el panel.")
    } finally {
      setLoadingData(false)
    }
  }, [showToast, isSuperAdmin, isSupervisora])

  useEffect(() => {
    if (loading || authLoading) return
    if (!isAuthenticated || !session?.access_token) return
    void loadData()
  }, [loading, authLoading, isAuthenticated, session?.access_token, loadData])

  const runChecks = useCallback(async () => {
    setRunningChecks(true)
    try {
      const results = await runBackendIntegrationChecks()
      setCheckResults(results)
      const failures = results.filter(item => item.status === "fail").length
      if (failures > 0) {
        showToast("error", `${failures} validaciones de backend fallaron.`)
      } else {
        showToast("success", "Validaciones de backend completadas.")
      }
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudieron ejecutar las validaciones.")
    } finally {
      setRunningChecks(false)
    }
  }, [showToast])

  return (
    <ProtectedRoute>
      <section className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-4 py-5 text-white shadow-sm sm:px-6 sm:py-6">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-300">Panel principal</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold sm:text-3xl">Panel operativo</h1>
            <Badge variant="info">Actualizado</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-slate-200">{roleSummary}</p>
        </div>

        {loading || authLoading || loadingData ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map(metric => (
                <Card
                  key={metric.label}
                  title={metric.label}
                  value={metric.value}
                  trend={metric.trend}
                  variant="stat"
                />
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card
                title="Estado operativo"
                subtitle="Monitoreo diario con trazabilidad y control por rol."
                className="lg:col-span-2"
              >
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Supervision</p>
                    <p className="text-sm font-semibold text-slate-800">
                      {isSuperAdmin || isSupervisora ? "Habilitada" : "Solo lectura"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Auditoria</p>
                    <p className="text-sm font-semibold text-slate-800">
                      {auditEvents.length} eventos recientes
                    </p>
                  </div>
                </div>
              </Card>

              <Card title="Acciones rapidas" subtitle="Atajos disponibles para tu rol.">
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
            </div>

            {(isSuperAdmin || isSupervisora) && (
              <Card
                title="Validacion de integracion backend"
                subtitle="Validacion en tiempo real de contratos Edge antes de liberar."
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void runChecks()} disabled={runningChecks} variant="secondary">
                    {runningChecks ? "Ejecutando..." : "Ejecutar validaciones"}
                  </Button>
                  {checkResults.length > 0 && (
                    <span className="text-xs text-slate-500">
                      Ultima ejecucion: {new Date().toLocaleString("es-CO")}
                    </span>
                  )}
                </div>

                {checkResults.length > 0 && (
                  <ul className="mt-4 space-y-2 text-sm">
                    {checkResults.map(item => (
                      <li key={item.endpoint} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                        <div>
                          <p className="font-medium text-slate-800">{item.endpoint}</p>
                          <p className="text-xs text-slate-500">{item.detail}</p>
                        </div>
                        <Badge
                          variant={
                            item.status === "pass"
                              ? "success"
                              : item.status === "warn"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {item.status === "pass" ? "OK" : item.status === "warn" ? "ALERTA" : "FALLO"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {auditEvents.length === 0 ? (
              <EmptyState
                title="Sin eventos de auditoria"
                description="No hay actividad reciente para mostrar."
                actionLabel="Actualizar panel"
                onAction={() => void loadData()}
              />
            ) : (
              <Card title="Linea de tiempo de auditoria" subtitle="Ultimos eventos operativos.">
                <ul className="space-y-2 text-sm text-slate-700">
                  {auditEvents.map(item => (
                    <li key={item.id} className="rounded-lg border border-slate-200 p-2">
                      <p className="font-medium">{item.action}</p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(item.created_at)} | Actor: {item.actor_id ?? "sistema"}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {isEmpleado && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Revisa tus turnos activos y finalizalos con evidencia de salida.
              </div>
            )}
          </>
        )}
      </section>
    </ProtectedRoute>
  )
}

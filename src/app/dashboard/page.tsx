"use client"

import ProtectedRoute from "@/components/ProtectedRoute"
import { useRole } from "@/hooks/useRole"
import Badge from "@/components/ui/Badge"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"

type Metric = {
  label: string
  value: string
  trend: string
}

const metrics: Metric[] = [
  { label: "Turnos activos", value: "18", trend: "+12% vs ayer" },
  { label: "Cumplimiento", value: "94%", trend: "+2% semanal" },
  { label: "Incidencias", value: "3", trend: "Sin bloqueos criticos" },
  { label: "Locales monitoreados", value: "27", trend: "Cobertura completa" },
]

export default function DashboardPage() {
  const { loading, isEmpleado, isSupervisora, isSuperAdmin } = useRole()

  const roleSummary = isSuperAdmin
    ? "Vista completa del sistema para administracion general."
    : isSupervisora
      ? "Seguimiento operativo de turnos e insumos en tiempo real."
      : "Control personal de asistencia y evidencias de turno."

  const quickActions = [
    { label: "Ver turnos del dia", variant: "primary" as const },
    { label: "Revisar incidencias", variant: "secondary" as const },
    ...(isSuperAdmin ? [{ label: "Gestionar usuarios", variant: "ghost" as const }] : []),
  ]

  const pendingAlerts: string[] = []

  return (
    <ProtectedRoute>
      <section className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-6 py-6 text-white shadow-sm">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-300">Panel principal</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold sm:text-3xl">Dashboard Operativo</h1>
            <Badge variant="info">Actualizado</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-slate-200">{roleSummary}</p>
        </div>

        {loading ? (
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
                title="Estado de operacion"
                subtitle="La plataforma mantiene actividad estable durante la ultima jornada. Recomendado: revisar cierres de turno pendientes antes de las 19:00."
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
                    <p className="text-xs text-slate-500">Evidencias</p>
                    <p className="text-sm font-semibold text-slate-800">Ultima carga hace 8 min</p>
                  </div>
                </div>
              </Card>

              <Card title="Acciones rapidas" subtitle="Atajos disponibles segun tu rol.">
                <div className="mt-4 space-y-2">
                  {quickActions.map(action => (
                    <Button key={action.label} fullWidth variant={action.variant}>
                      {action.label}
                    </Button>
                  ))}
                </div>
              </Card>
            </div>

            {pendingAlerts.length === 0 ? (
              <EmptyState
                title="Sin alertas criticas"
                description="No hay incidencias pendientes de atencion inmediata."
                actionLabel="Actualizar tablero"
                onAction={() => window.location.reload()}
              />
            ) : (
              <Card title="Alertas pendientes">
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {pendingAlerts.map(alert => (
                    <li key={alert}>{alert}</li>
                  ))}
                </ul>
              </Card>
            )}

            {isEmpleado && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Tienes 1 turno pendiente de cierre. Recuerda adjuntar evidencia al finalizar.
              </div>
            )}
          </>
        )}
      </section>
    </ProtectedRoute>
  )
}

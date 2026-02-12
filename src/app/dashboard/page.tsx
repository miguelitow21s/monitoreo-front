"use client"

import ProtectedRoute from "@/components/ProtectedRoute"
import { useRole } from "@/hooks/useRole"

type MetricCardProps = {
  label: string
  value: string
  trend: string
}

function MetricCard({ label, value, trend }: MetricCardProps) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
      <p className="mt-2 text-xs text-emerald-600">{trend}</p>
    </article>
  )
}

export default function DashboardPage() {
  const { loading, isEmpleado, isSupervisora, isSuperAdmin } = useRole()

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200" />
        ))}
      </div>
    )
  }

  const roleSummary = isSuperAdmin
    ? "Vista completa del sistema para administracion general."
    : isSupervisora
      ? "Seguimiento operativo de turnos e insumos en tiempo real."
      : "Control personal de asistencia y evidencias de turno."

  return (
    <ProtectedRoute>
      <section className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 px-6 py-6 text-white shadow-sm">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-300">Panel principal</p>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Dashboard Operativo</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-200">{roleSummary}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Turnos activos" value="18" trend="+12% vs ayer" />
          <MetricCard label="Cumplimiento" value="94%" trend="+2% semanal" />
          <MetricCard label="Incidencias" value="3" trend="Sin nuevos bloqueos" />
          <MetricCard label="Locales monitoreados" value="27" trend="Cobertura completa" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-base font-semibold text-slate-900">Estado de operacion</h2>
            <p className="mt-2 text-sm text-slate-600">
              La plataforma mantiene actividad estable durante la ultima jornada.
              Recomendado: revisar cierres de turno pendientes antes de las 19:00.
            </p>
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
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Acciones rapidas</h2>
            <div className="mt-4 space-y-2">
              <button className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
                Ver turnos del dia
              </button>
              <button className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
                Revisar incidencias
              </button>
              {isSuperAdmin && (
                <button className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
                  Gestionar usuarios
                </button>
              )}
            </div>
          </article>
        </div>

        {isEmpleado && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Tienes 1 turno pendiente de cierre. Recuerda adjuntar evidencia al finalizar.
          </div>
        )}
      </section>
    </ProtectedRoute>
  )
}

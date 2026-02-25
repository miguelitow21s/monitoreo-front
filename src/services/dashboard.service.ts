import { supabase } from "@/services/supabaseClient"

export interface DashboardMetric {
  label: string
  value: string
  trend: string
}

export interface AuditEvent {
  id: string
  action: string
  created_at: string
  actor_id: string | null
}

export async function fetchDashboardMetrics() {
  const [{ count: activeCount, error: activeError }, { count: totalCount, error: totalError }, { count: incidentsCount, error: incidentsError }, { count: restaurantsCount, error: restaurantsError }] =
    await Promise.all([
      supabase.from("shifts").select("id", { count: "exact", head: true }).is("end_time", null),
      supabase.from("shifts").select("id", { count: "exact", head: true }),
      supabase.from("shift_incidents").select("id", { count: "exact", head: true }),
      supabase.from("restaurants").select("id", { count: "exact", head: true }),
    ])

  if (activeError) throw activeError
  if (totalError) throw totalError
  if (incidentsError) throw incidentsError
  if (restaurantsError) throw restaurantsError

  const activeShifts = activeCount ?? 0
  const totalShifts = totalCount ?? 0
  const incidents = incidentsCount ?? 0
  const restaurants = restaurantsCount ?? 0

  const completion = totalShifts > 0 ? Math.round(((totalShifts - activeShifts) / totalShifts) * 100) : 0

  const metrics: DashboardMetric[] = [
    { label: "Turnos activos", value: String(activeShifts), trend: "Actualizacion en tiempo real" },
    { label: "Cumplimiento", value: `${completion}%`, trend: "Turnos cerrados vs total" },
    { label: "Novedades", value: String(incidents), trend: "Reportes operativos acumulados" },
    { label: "Sedes monitoreadas", value: String(restaurants), trend: "Cobertura total registrada" },
  ]

  return metrics
}

export async function fetchAuditEvents(limit = 12) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id,action,created_at,actor_id")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as AuditEvent[]
}

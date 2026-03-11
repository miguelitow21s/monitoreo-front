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
  const [{ count: activeCount, error: activeError }, { count: totalCount, error: totalError }, { count: incidentsCount, error: incidentsError }, { count: restaurantsCount, error: restaurantsError }, completedShifts] =
    await Promise.all([
      supabase.from("shifts").select("id", { count: "exact", head: true }).is("end_time", null),
      supabase.from("shifts").select("id", { count: "exact", head: true }),
      supabase.from("shift_incidents").select("id", { count: "exact", head: true }),
      supabase.from("restaurants").select("id", { count: "exact", head: true }),
      supabase
        .from("shifts")
        .select("start_time,end_time")
        .not("end_time", "is", null)
        .order("start_time", { ascending: false })
        .limit(200),
    ])

  if (activeError) throw activeError
  if (totalError) throw totalError
  if (incidentsError) throw incidentsError
  if (restaurantsError) throw restaurantsError
  if (completedShifts.error) throw completedShifts.error

  const activeShifts = activeCount ?? 0
  const totalShifts = totalCount ?? 0
  const incidents = incidentsCount ?? 0
  const restaurants = restaurantsCount ?? 0

  const completion = totalShifts > 0 ? Math.round(((totalShifts - activeShifts) / totalShifts) * 100) : 0
  const completedRows = (completedShifts.data ?? []) as Array<{ start_time: string; end_time: string | null }>
  const avgMinutes =
    completedRows.length === 0
      ? 0
      : Math.round(
          completedRows.reduce((acc, row) => {
            if (!row.end_time) return acc
            const start = new Date(row.start_time).getTime()
            const end = new Date(row.end_time).getTime()
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return acc
            return acc + Math.floor((end - start) / 60000)
          }, 0) / completedRows.length
        )

  const deliveryCostRows = await supabase
    .from("supply_deliveries")
    .select("quantity,supplies: supply_id (unit_cost)")
    .order("delivered_at", { ascending: false })
    .limit(200)

  if (deliveryCostRows.error) throw deliveryCostRows.error

  const estimatedSupplyCost = ((deliveryCostRows.data ?? []) as Array<{
    quantity: number | null
    supplies?: { unit_cost?: number | null } | Array<{ unit_cost?: number | null }> | null
  }>).reduce((acc, item) => {
    const quantity = Number(item.quantity ?? 0)
    const supply = Array.isArray(item.supplies) ? item.supplies[0] : item.supplies
    const unitCost = Number(supply?.unit_cost ?? 0)
    if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) return acc
    return acc + quantity * unitCost
  }, 0)

  const avgHours = (avgMinutes / 60).toFixed(1)

  const metrics: DashboardMetric[] = [
    { label: "Active shifts", value: String(activeShifts), trend: "Real-time updates" },
    { label: "Compliance", value: `${completion}%`, trend: "Closed shifts vs total" },
    { label: "Incidents", value: String(incidents), trend: "Accumulated operational reports" },
    { label: "Avg shift duration", value: `${avgHours}h`, trend: "Productivity baseline" },
    { label: "Estimated supply cost", value: `$${estimatedSupplyCost.toFixed(0)}`, trend: "Deliveries x unit cost" },
    { label: "Monitored sites", value: String(restaurants), trend: "Total registered coverage" },
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

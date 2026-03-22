import { invokeEdge } from "@/services/edgeClient"

export interface DashboardMetric {
  label: string
  value: string
  trend: string
}

interface AdminMetricRow {
  key?: string
  label?: string
  value?: string | number | null
  trend?: string | null
}

interface AdminSummaryPayload {
  users?: {
    total?: number
    active?: number
    inactive?: number
  }
  restaurants?: {
    total?: number
    active?: number
  }
  shifts?: {
    total?: number
    active?: number
    finished?: number
  }
  productivity?: {
    hours_worked_total?: number
    average_hours_per_shift?: number
    operational_tasks_completed?: number
    operational_tasks_pending?: number
  }
  incidents?: {
    total?: number
  }
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export interface AuditEvent {
  id: string
  action: string
  created_at: string
  actor_id: string | null
}

export async function fetchDashboardMetrics(options?: {
  useAdminApi?: boolean
  periodStart?: string
  periodEnd?: string
  restaurantId?: number
}) {
  if (!options?.useAdminApi) {
    return []
  }

  const payload = await invokeEdge<unknown>("admin_dashboard_metrics", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "summary",
      ...(options.periodStart ? { period_start: options.periodStart } : {}),
      ...(options.periodEnd ? { period_end: options.periodEnd } : {}),
      ...(typeof options.restaurantId === "number" ? { restaurant_id: options.restaurantId } : {}),
    },
  })

  if (Array.isArray(payload)) {
    const rows = payload as unknown[]
    return rows
      .map(item => {
        const metric = item as AdminMetricRow
        const label = metric.label ?? metric.key ?? "Metric"
        const value = metric.value === null || metric.value === undefined ? "-" : String(metric.value)
        return {
          label,
          value,
          trend: metric.trend ?? "Executive metric",
        } satisfies DashboardMetric
      })
      .filter(item => item.label.trim().length > 0)
  }

  if (payload && typeof payload === "object") {
    const summary = payload as AdminSummaryPayload
    const activeShifts = toNumber(summary.shifts?.active)
    const totalShifts = toNumber(summary.shifts?.total)
    const completion = totalShifts > 0 ? Math.round(((totalShifts - activeShifts) / totalShifts) * 100) : 0

    return [
      { label: "Active shifts", value: String(activeShifts), trend: "Executive summary" },
      { label: "Compliance", value: `${completion}%`, trend: "Finished over total shifts" },
      { label: "Incidents", value: String(toNumber(summary.incidents?.total)), trend: "Incident volume" },
      {
        label: "Avg shift duration",
        value: `${toNumber(summary.productivity?.average_hours_per_shift).toFixed(1)}h`,
        trend: "Average hours per shift",
      },
      {
        label: "Estimated supply cost",
        value: `$${toNumber(summary.productivity?.operational_tasks_completed)}`,
        trend: "Tasks completed",
      },
      {
        label: "Monitored sites",
        value: String(toNumber(summary.restaurants?.active || summary.restaurants?.total)),
        trend: "Active restaurants",
      },
    ]
  }

  return []
}

export async function fetchAuditEvents(limit = 12) {
  const payload = await invokeEdge<unknown>("audit_logs_manage", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "list",
      limit,
    },
  })

  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : []

  return items
    .map(item => {
      const row = item as Record<string, unknown>
      const id = row.id ? String(row.id) : ""
      const action = typeof row.action === "string" ? row.action : ""
      const createdAt = typeof row.created_at === "string" ? row.created_at : ""
      const actorId = typeof row.actor_id === "string" ? row.actor_id : row.actor_id ? String(row.actor_id) : null
      if (!id || !action || !createdAt) return null
      return { id, action, created_at: createdAt, actor_id: actorId } satisfies AuditEvent
    })
    .filter((row): row is AuditEvent => row !== null)
}

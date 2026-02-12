import { supabase } from "@/services/supabaseClient"
import { withRetry } from "@/utils/retry"

export interface ReportRow {
  id: string
  restaurant_id: string | null
  start_time: string
  end_time: string | null
  status: string
}

export async function fetchShiftsReport(fromIso?: string, toIso?: string, restaurantId?: string) {
  return withRetry(async () => {
    let query = supabase.from("shifts").select("id,restaurant_id,start_time,end_time,status").order("start_time", { ascending: false })

    if (fromIso) query = query.gte("start_time", fromIso)
    if (toIso) query = query.lte("start_time", toIso)
    if (restaurantId) query = query.eq("restaurant_id", restaurantId)

    const { data, error } = await query.limit(500)
    if (error) throw error
    return (data ?? []) as ReportRow[]
  })
}

export function exportReportCsv(rows: ReportRow[]) {
  const header = ["id", "restaurant_id", "start_time", "end_time", "status"]
  const lines = rows.map(row => [row.id, row.restaurant_id ?? "", row.start_time, row.end_time ?? "", row.status])
  const csv = [header, ...lines].map(line => line.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n")

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `reporte-turnos-${Date.now()}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

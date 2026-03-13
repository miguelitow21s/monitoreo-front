"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"
import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { useToast } from "@/components/toast/ToastProvider"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import { listMySupervisorRestaurants, listRestaurants, Restaurant } from "@/services/restaurants.service"
import {
  createSupply,
  listSupplies,
  listSupplyDeliveries,
  listSupplyDeliveriesByPeriod,
  registerSupplyDelivery,
  Supply,
  SupplyDelivery,
} from "@/services/supplies.service"
import { debugLog } from "@/services/debug"
import { ROLES } from "@/utils/permissions"

function extractError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function toIsoStart(date: string) {
  if (!date) return undefined
  return new Date(`${date}T00:00:00`).toISOString()
}

function toIsoEnd(date: string) {
  if (!date) return undefined
  return new Date(`${date}T23:59:59`).toISOString()
}

function defaultPeriodStart() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
}

function defaultPeriodEnd() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const csv = [header, ...rows]
    .map(line => line.map(value => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\n")

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function toRestaurantShape(id: number, name: string): Restaurant {
  return {
    id: String(id),
    name,
    is_active: true,
    lat: null,
    lng: null,
    geofence_radius_m: null,
  }
}

export default function SuppliesPage() {
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { loading: roleLoading, isSuperAdmin, isSupervisora } = useRole()
  const { formatDateTime, t } = useI18n()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [deliveries, setDeliveries] = useState<SupplyDelivery[]>([])
  const [analyticsDeliveries, setAnalyticsDeliveries] = useState<SupplyDelivery[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])

  const [supplyName, setSupplyName] = useState("")
  const [supplyUnit, setSupplyUnit] = useState("unit")
  const [supplyStock, setSupplyStock] = useState("0")
  const [supplyUnitCost, setSupplyUnitCost] = useState("0")

  const [deliverySupplyId, setDeliverySupplyId] = useState("")
  const [deliveryRestaurantId, setDeliveryRestaurantId] = useState("")
  const [deliveryQuantity, setDeliveryQuantity] = useState("1")
  const [deliveryDeliveredAt, setDeliveryDeliveredAt] = useState("")

  const [periodFrom, setPeriodFrom] = useState(defaultPeriodStart)
  const [periodTo, setPeriodTo] = useState(defaultPeriodEnd)
  const [analysisRestaurantId, setAnalysisRestaurantId] = useState("")
  const canCreateSupply = isSuperAdmin
  const canAccessSupplies = isSuperAdmin || isSupervisora

  const loadData = useCallback(async () => {
    if (!canAccessSupplies) return
    setLoading(true)
    try {
      const restaurantRows = isSupervisora
        ? (await listMySupervisorRestaurants()).map(item => toRestaurantShape(item.id, item.name))
        : await listRestaurants(isSuperAdmin ? { useAdminApi: true } : undefined)

      const scopedRestaurantId =
        deliveryRestaurantId && restaurantRows.some(item => item.id === deliveryRestaurantId)
          ? deliveryRestaurantId
          : restaurantRows[0]?.id

      debugLog("supplies.loadData", {
        isSupervisora,
        isSuperAdmin,
        deliveryRestaurantId,
        scopedRestaurantId,
        restaurantsCount: restaurantRows.length,
      })

      if (!scopedRestaurantId) {
        setSupplies([])
        setDeliveries([])
        setRestaurants(restaurantRows)
        setDeliveryRestaurantId("")
        setAnalysisRestaurantId(prev => (prev && restaurantRows.some(item => item.id === prev) ? prev : ""))
        return
      }

      const [suppliesRows, deliveryRows] = await Promise.all([
        listSupplies({ restaurantId: scopedRestaurantId }),
        listSupplyDeliveries(40, { restaurantId: scopedRestaurantId }),
      ])

      setSupplies(suppliesRows)
      setDeliveries(deliveryRows)
      setRestaurants(restaurantRows)

      setDeliverySupplyId(prev => prev || suppliesRows[0]?.id || "")
      setDeliveryRestaurantId(prev => {
        if (scopedRestaurantId) return scopedRestaurantId
        if (prev && restaurantRows.some(item => item.id === prev)) return prev
        return restaurantRows[0]?.id || ""
      })
      setAnalysisRestaurantId(prev => {
        if (prev && restaurantRows.some(item => item.id === prev)) return prev
        return scopedRestaurantId ?? ""
      })
    } catch (error: unknown) {
      showToast("error", extractError(error, t("No se pudo cargar el modulo de insumos.", "Could not load supplies module.")))
    } finally {
      setLoading(false)
    }
  }, [canAccessSupplies, deliveryRestaurantId, isSuperAdmin, isSupervisora, showToast, t])

  useEffect(() => {
    if (authLoading || roleLoading) return
    if (!isAuthenticated || !session?.access_token) return
    if (!canAccessSupplies) return
    void loadData()
  }, [authLoading, roleLoading, isAuthenticated, session?.access_token, canAccessSupplies, loadData])

  useEffect(() => {
    if (!isSupervisora) return
    if (restaurants.length === 0) {
      setDeliveryRestaurantId("")
      setAnalysisRestaurantId("")
      return
    }

    setDeliveryRestaurantId(prev => (prev && restaurants.some(item => item.id === prev) ? prev : restaurants[0]?.id ?? ""))
    setAnalysisRestaurantId(prev => (prev && restaurants.some(item => item.id === prev) ? prev : restaurants[0]?.id ?? ""))
  }, [isSupervisora, restaurants])

  const loadAnalytics = useCallback(async () => {
    if (authLoading || roleLoading || !canAccessSupplies || !isAuthenticated || !session?.access_token) return

    const scopedRestaurantId = analysisRestaurantId || deliveryRestaurantId || restaurants[0]?.id || undefined

    debugLog("supplies.loadAnalytics", {
      isSupervisora,
      isSuperAdmin,
      analysisRestaurantId,
      deliveryRestaurantId,
      scopedRestaurantId,
      periodFrom,
      periodTo,
    })

    if (!scopedRestaurantId) {
      setAnalyticsDeliveries([])
      return
    }

    setAnalyticsLoading(true)
    try {
      const rows = await listSupplyDeliveriesByPeriod({
        fromIso: toIsoStart(periodFrom),
        toIso: toIsoEnd(periodTo),
        restaurantId: scopedRestaurantId,
        limit: 4000,
      })
      setAnalyticsDeliveries(rows)
    } catch (error: unknown) {
      showToast("error", extractError(error, t("No se pudo cargar el analisis de consumo.", "Could not load consumption analytics.")))
    } finally {
      setAnalyticsLoading(false)
    }
  }, [
    analysisRestaurantId,
    authLoading,
    canAccessSupplies,
    deliveryRestaurantId,
    isAuthenticated,
    isSuperAdmin,
    isSupervisora,
    periodFrom,
    periodTo,
    roleLoading,
    restaurants,
    session?.access_token,
    showToast,
    t,
  ])

  useEffect(() => {
    if (authLoading || roleLoading) return
    if (!isAuthenticated || !session?.access_token) return
    if (!canAccessSupplies) return
    void loadAnalytics()
  }, [authLoading, roleLoading, isAuthenticated, session?.access_token, canAccessSupplies, loadAnalytics])

  const suppliesById = useMemo(() => {
    const map = new Map<string, Supply>()
    for (const item of supplies) map.set(item.id, item)
    return map
  }, [supplies])

  const restaurantsById = useMemo(() => {
    const map = new Map<string, Restaurant>()
    for (const item of restaurants) map.set(item.id, item)
    return map
  }, [restaurants])

  const inconsistencies = useMemo(
    () => supplies.filter(item => Number(item.stock ?? 0) < 0),
    [supplies]
  )

  const estimatedInventoryCost = useMemo(
    () =>
      supplies.reduce((acc, item) => {
        const stock = Number(item.stock ?? 0)
        const unitCost = Number(item.unit_cost ?? 0)
        if (!Number.isFinite(stock) || !Number.isFinite(unitCost)) return acc
        return acc + stock * unitCost
      }, 0),
    [supplies]
  )

  const expenseByRestaurant = useMemo(() => {
    const grouped = new Map<
      string,
      { restaurantName: string; totalQuantity: number; totalCost: number; deliveries: number; lastDelivery: string | null }
    >()

    for (const delivery of analyticsDeliveries) {
      const key = delivery.restaurant_id
      const restaurantName = restaurantsById.get(key)?.name ?? t("Restaurante sin nombre", "Unnamed restaurant")
      const supply = suppliesById.get(delivery.supply_id)
      const quantity = Number(delivery.quantity ?? 0)
      const unitCost = Number(supply?.unit_cost ?? 0)
      const totalCost = Number.isFinite(quantity) && Number.isFinite(unitCost) ? quantity * unitCost : 0

      const current = grouped.get(key) ?? {
        restaurantName,
        totalQuantity: 0,
        totalCost: 0,
        deliveries: 0,
        lastDelivery: null,
      }

      current.totalQuantity += Number.isFinite(quantity) ? quantity : 0
      current.totalCost += totalCost
      current.deliveries += 1
      if (!current.lastDelivery || new Date(delivery.delivered_at).getTime() > new Date(current.lastDelivery).getTime()) {
        current.lastDelivery = delivery.delivered_at
      }

      grouped.set(key, current)
    }

    return [...grouped.entries()]
      .map(([restaurantId, value]) => ({ restaurantId, ...value }))
      .sort((a, b) => b.totalCost - a.totalCost)
  }, [analyticsDeliveries, restaurantsById, suppliesById, t])

  const historicalConsumption = useMemo(() => {
    const grouped = new Map<
      string,
      {
        restaurantName: string
        supplyName: string
        unit: string
        totalQuantity: number
        totalCost: number
        deliveries: number
        lastDelivery: string | null
      }
    >()

    for (const delivery of analyticsDeliveries) {
      const supply = suppliesById.get(delivery.supply_id)
      const supplyName = supply?.name ?? t("Insumo no identificado", "Unknown supply")
      const unit = supply?.unit ?? "unit"
      const unitCost = Number(supply?.unit_cost ?? 0)
      const quantity = Number(delivery.quantity ?? 0)
      const restaurantName = restaurantsById.get(delivery.restaurant_id)?.name ?? t("Restaurante sin nombre", "Unnamed restaurant")
      const key = `${delivery.restaurant_id}::${delivery.supply_id}`

      const current = grouped.get(key) ?? {
        restaurantName,
        supplyName,
        unit,
        totalQuantity: 0,
        totalCost: 0,
        deliveries: 0,
        lastDelivery: null,
      }

      current.totalQuantity += Number.isFinite(quantity) ? quantity : 0
      current.totalCost += Number.isFinite(quantity) && Number.isFinite(unitCost) ? quantity * unitCost : 0
      current.deliveries += 1
      if (!current.lastDelivery || new Date(delivery.delivered_at).getTime() > new Date(current.lastDelivery).getTime()) {
        current.lastDelivery = delivery.delivered_at
      }

      grouped.set(key, current)
    }

    return [...grouped.values()].sort((a, b) => b.totalCost - a.totalCost)
  }, [analyticsDeliveries, restaurantsById, suppliesById, t])

  const atypicalConsumption = useMemo(() => {
    const grouped = new Map<string, SupplyDelivery[]>()
    for (const delivery of analyticsDeliveries) {
      const key = `${delivery.restaurant_id}::${delivery.supply_id}`
      const current = grouped.get(key) ?? []
      current.push(delivery)
      grouped.set(key, current)
    }

    const flagged: Array<{
      id: string
      restaurantName: string
      supplyName: string
      quantity: number
      averageQuantity: number
      estimatedCost: number
      deliveredAt: string
    }> = []

    for (const rows of grouped.values()) {
      if (rows.length < 3) continue
      const quantities = rows.map(item => Number(item.quantity ?? 0)).filter(item => Number.isFinite(item) && item > 0)
      if (quantities.length < 3) continue

      const average = quantities.reduce((acc, item) => acc + item, 0) / quantities.length
      const variance = quantities.reduce((acc, item) => acc + (item - average) ** 2, 0) / quantities.length
      const std = Math.sqrt(variance)
      const threshold = Math.max(average * 1.8, average + std * 2)

      for (const row of rows) {
        const quantity = Number(row.quantity ?? 0)
        if (!Number.isFinite(quantity) || quantity <= threshold) continue
        const supply = suppliesById.get(row.supply_id)
        const restaurantName = restaurantsById.get(row.restaurant_id)?.name ?? t("Restaurante sin nombre", "Unnamed restaurant")
        flagged.push({
          id: row.id,
          restaurantName,
          supplyName: supply?.name ?? t("Insumo no identificado", "Unknown supply"),
          quantity,
          averageQuantity: average,
          estimatedCost: quantity * Number(supply?.unit_cost ?? 0),
          deliveredAt: row.delivered_at,
        })
      }
    }

    return flagged.sort((a, b) => b.quantity - a.quantity)
  }, [analyticsDeliveries, restaurantsById, suppliesById, t])

  const totalExpenseInPeriod = useMemo(
    () => expenseByRestaurant.reduce((acc, item) => acc + item.totalCost, 0),
    [expenseByRestaurant]
  )

  const handleExportOperationalReport = () => {
    downloadCsv(
      `operational-expenses-${periodFrom}-to-${periodTo || "today"}.csv`,
      [
        t("Restaurante", "Restaurant"),
        t("Entregas", "Deliveries"),
        t("Cantidad total", "Total quantity"),
        t("Gasto estimado", "Estimated expense"),
        t("Ultima entrega", "Last delivery"),
      ],
      expenseByRestaurant.map(item => [
        item.restaurantName,
        item.deliveries,
        item.totalQuantity.toFixed(2),
        item.totalCost.toFixed(2),
        item.lastDelivery ? formatDateTime(item.lastDelivery) : "-",
      ])
    )
  }

  const handleExportOperationalReportPdf = () => {
    const reportTitle = t("Reporte de gastos operativos", "Operational expense report")
    const periodLabel = `${periodFrom} - ${periodTo || "today"}`
    const rowsHtml = expenseByRestaurant
      .map(
        item => `
          <tr>
            <td>${escapeHtml(item.restaurantName)}</td>
            <td>${item.deliveries}</td>
            <td>${item.totalQuantity.toFixed(2)}</td>
            <td>$${item.totalCost.toFixed(2)}</td>
            <td>${escapeHtml(item.lastDelivery ? formatDateTime(item.lastDelivery) : "-")}</td>
          </tr>
        `
      )
      .join("")

    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=980,height=700")
    if (!printWindow) {
      showToast("error", t("No se pudo abrir la ventana para exportar PDF.", "Could not open PDF export window."))
      return
    }

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(reportTitle)}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
            h1 { margin: 0 0 8px; font-size: 20px; }
            p { margin: 0 0 12px; color: #475569; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
            th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
            th { background: #f1f5f9; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(reportTitle)}</h1>
          <p>${escapeHtml(t("Periodo", "Period"))}: ${escapeHtml(periodLabel)}</p>
          <p>${escapeHtml(t("Gasto total estimado", "Estimated total expense"))}: $${totalExpenseInPeriod.toFixed(2)}</p>
          <table>
            <thead>
              <tr>
                <th>${escapeHtml(t("Restaurante", "Restaurant"))}</th>
                <th>${escapeHtml(t("Entregas", "Deliveries"))}</th>
                <th>${escapeHtml(t("Cantidad total", "Total quantity"))}</th>
                <th>${escapeHtml(t("Gasto estimado", "Estimated expense"))}</th>
                <th>${escapeHtml(t("Ultima entrega", "Last delivery"))}</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <script>
            window.print();
          </script>
        </body>
      </html>
    `

    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
  }

  const handleCreateSupply = async () => {
    const parsedStock = Number(supplyStock)
    const parsedUnitCost = Number(supplyUnitCost)
    if (!supplyName.trim() || !Number.isFinite(parsedStock) || !Number.isFinite(parsedUnitCost) || parsedUnitCost < 0) {
      showToast("info", t("Completa nombre, stock y costo valido.", "Enter a valid name, stock, and unit cost."))
      return
    }

    try {
      const created = await createSupply({
        name: supplyName.trim(),
        unit: supplyUnit.trim() || "unit",
        stock: parsedStock,
        unit_cost: parsedUnitCost,
        restaurant_id: null,
      })
      setSupplies(prev => [created, ...prev])
      setSupplyName("")
      setSupplyStock("0")
      setSupplyUnitCost("0")
      showToast("success", t("Insumo creado.", "Supply created."))
    } catch (error: unknown) {
      showToast("error", extractError(error, t("No se pudo crear el insumo.", "Could not create supply.")))
    }
  }

  const handleRegisterDelivery = async () => {
    const parsedQuantity = Number(deliveryQuantity)
    if (!deliverySupplyId || !deliveryRestaurantId || !Number.isFinite(parsedQuantity)) {
      showToast("info", t("Selecciona insumo, restaurante y cantidad valida.", "Select supply, restaurant, and valid quantity."))
      return
    }

    try {
      const created = await registerSupplyDelivery({
        supply_id: deliverySupplyId,
        restaurant_id: deliveryRestaurantId,
        quantity: parsedQuantity,
        delivered_at: deliveryDeliveredAt ? new Date(deliveryDeliveredAt).toISOString() : undefined,
      })
      setDeliveries(prev => [created, ...prev].slice(0, 40))
      void loadAnalytics()
      setDeliveryDeliveredAt("")
      showToast("success", t("Entrega registrada.", "Delivery registered."))
    } catch (error: unknown) {
      showToast("error", extractError(error, t("No se pudo registrar la entrega.", "Could not register delivery.")))
    }
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPERVISORA, ROLES.SUPER_ADMIN]}>
        <div className="space-y-5">
          <h1 className="text-2xl font-bold text-slate-900">{t("Insumos", "Supplies")}</h1>

          {loading || authLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <>
              {canCreateSupply && (
                <Card title={t("Crear insumo", "Create supply")}>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    <input
                      value={supplyName}
                      onChange={event => setSupplyName(event.target.value)}
                      placeholder={t("Nombre", "Name")}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      value={supplyUnit}
                      onChange={event => setSupplyUnit(event.target.value)}
                      placeholder={t("Unidad", "Unit")}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      value={supplyStock}
                      onChange={event => setSupplyStock(event.target.value)}
                      placeholder={t("Stock inicial", "Initial stock")}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      value={supplyUnitCost}
                      onChange={event => setSupplyUnitCost(event.target.value)}
                      placeholder={t("Costo unitario", "Unit cost")}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <Button onClick={handleCreateSupply}>{t("Guardar", "Save")}</Button>
                  </div>
                </Card>
              )}

              <Card title={t("Registrar entrega", "Register delivery")}>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  <select
                    value={deliverySupplyId}
                    onChange={event => setDeliverySupplyId(event.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {supplies.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={deliveryRestaurantId}
                    onChange={event => setDeliveryRestaurantId(event.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {restaurants.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={deliveryQuantity}
                    onChange={event => setDeliveryQuantity(event.target.value)}
                    placeholder={t("Cantidad", "Quantity")}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="datetime-local"
                    value={deliveryDeliveredAt}
                    onChange={event => setDeliveryDeliveredAt(event.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <Button variant="secondary" onClick={handleRegisterDelivery}>
                    {t("Registrar", "Register")}
                  </Button>
                </div>
              </Card>

              <Card title={t("Control de gastos operativos", "Operational expense control")}>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  <input
                    type="date"
                    value={periodFrom}
                    onChange={event => setPeriodFrom(event.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="date"
                    value={periodTo}
                    onChange={event => setPeriodTo(event.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <select
                    value={analysisRestaurantId}
                    onChange={event => setAnalysisRestaurantId(event.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {!isSupervisora && <option value="">{t("Todos los restaurantes", "All restaurants")}</option>}
                    {restaurants.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" onClick={() => void loadAnalytics()}>
                    {t("Actualizar", "Refresh")}
                  </Button>
                  <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-2">
                    <Button onClick={handleExportOperationalReport}>{t("Exportar gastos CSV", "Export expense CSV")}</Button>
                    <Button variant="ghost" onClick={handleExportOperationalReportPdf}>{t("Exportar PDF", "Export PDF")}</Button>
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {t("Gasto total estimado del periodo", "Estimated total expense in period")}: ${totalExpenseInPeriod.toFixed(2)}
                </p>
              </Card>

              <Card title={t("Gastos por restaurante", "Expenses by restaurant")}>
                {analyticsLoading ? (
                  <Skeleton className="h-20" />
                ) : expenseByRestaurant.length === 0 ? (
                  <p className="text-sm text-slate-500">{t("Sin datos para el periodo seleccionado.", "No data for selected period.")}</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="pb-2 pr-3">{t("Restaurante", "Restaurant")}</th>
                          <th className="pb-2 pr-3">{t("Entregas", "Deliveries")}</th>
                          <th className="pb-2 pr-3">{t("Cantidad total", "Total quantity")}</th>
                          <th className="pb-2 pr-3">{t("Gasto estimado", "Estimated expense")}</th>
                          <th className="pb-2 pr-3">{t("Ultima entrega", "Last delivery")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenseByRestaurant.map(item => (
                          <tr key={item.restaurantId} className="border-b border-slate-100">
                            <td className="py-2 pr-3">{item.restaurantName}</td>
                            <td className="py-2 pr-3">{item.deliveries}</td>
                            <td className="py-2 pr-3">{item.totalQuantity.toFixed(2)}</td>
                            <td className="py-2 pr-3">${item.totalCost.toFixed(2)}</td>
                            <td className="py-2 pr-3">{item.lastDelivery ? formatDateTime(item.lastDelivery) : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title={t("Consumo historico", "Historical consumption")}>
                {analyticsLoading ? (
                  <Skeleton className="h-20" />
                ) : historicalConsumption.length === 0 ? (
                  <p className="text-sm text-slate-500">{t("Aun no hay consumo registrado para analizar.", "No registered consumption yet.")}</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="pb-2 pr-3">{t("Restaurante", "Restaurant")}</th>
                          <th className="pb-2 pr-3">{t("Insumo", "Supply")}</th>
                          <th className="pb-2 pr-3">{t("Entregas", "Deliveries")}</th>
                          <th className="pb-2 pr-3">{t("Cantidad total", "Total quantity")}</th>
                          <th className="pb-2 pr-3">{t("Gasto estimado", "Estimated expense")}</th>
                          <th className="pb-2 pr-3">{t("Ultima entrega", "Last delivery")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historicalConsumption.map(item => (
                          <tr key={`${item.restaurantName}-${item.supplyName}`} className="border-b border-slate-100">
                            <td className="py-2 pr-3">{item.restaurantName}</td>
                            <td className="py-2 pr-3">{item.supplyName}</td>
                            <td className="py-2 pr-3">{item.deliveries}</td>
                            <td className="py-2 pr-3">{item.totalQuantity.toFixed(2)} {item.unit}</td>
                            <td className="py-2 pr-3">${item.totalCost.toFixed(2)}</td>
                            <td className="py-2 pr-3">{item.lastDelivery ? formatDateTime(item.lastDelivery) : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title={t("Consumos atipicos", "Atypical consumption")}>
                {analyticsLoading ? (
                  <Skeleton className="h-20" />
                ) : atypicalConsumption.length === 0 ? (
                  <p className="text-sm text-emerald-700">{t("No se detectaron consumos atipicos en el periodo.", "No atypical consumption detected in the period.")}</p>
                ) : (
                  <ul className="space-y-2 text-sm text-amber-900">
                    {atypicalConsumption.slice(0, 20).map(item => (
                      <li key={item.id} className="rounded-lg border border-amber-200 bg-amber-50 p-2">
                        <strong>{item.restaurantName}</strong> - {item.supplyName}: {item.quantity.toFixed(2)} ({t("promedio", "average")}: {item.averageQuantity.toFixed(2)}) - ${item.estimatedCost.toFixed(2)} - {formatDateTime(item.deliveredAt)}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title={t("Inventario actual", "Current inventory")}>
                <p className="mb-3 text-sm text-slate-600">
                  {t("Costo estimado de inventario", "Estimated inventory cost")}: ${estimatedInventoryCost.toFixed(0)}
                </p>
                {supplies.length === 0 ? (
                  <EmptyState
                    title={t("Sin insumos", "No supplies")}
                    description={t("Crea el primer insumo para comenzar.", "Create the first supply to start.")}
                    actionLabel={t("Recargar", "Reload")}
                    onAction={() => void loadData()}
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2 md:hidden">
                      {supplies.map(item => (
                        <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                          <p className="font-medium text-slate-900">{item.name}</p>
                          <p className="mt-1 text-sm text-slate-600">{t("Unidad", "Unit")}: {item.unit}</p>
                          <p className="mt-1 text-sm text-slate-600">{t("Stock", "Stock")}: {item.stock}</p>
                          <p className="mt-1 text-sm text-slate-600">{t("Costo unitario", "Unit cost")}: ${Number(item.unit_cost ?? 0).toFixed(2)}</p>
                        </div>
                      ))}
                    </div>

                    <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-500">
                            <th className="pb-2 pr-3">{t("Nombre", "Name")}</th>
                            <th className="pb-2 pr-3">{t("Unidad", "Unit")}</th>
                            <th className="pb-2 pr-3">{t("Stock", "Stock")}</th>
                            <th className="pb-2 pr-3">{t("Costo unitario", "Unit cost")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supplies.map(item => (
                            <tr key={item.id} className="border-b border-slate-100">
                              <td className="py-2 pr-3">{item.name}</td>
                              <td className="py-2 pr-3">{item.unit}</td>
                              <td className="py-2 pr-3">{item.stock}</td>
                              <td className="py-2 pr-3">${Number(item.unit_cost ?? 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Card>

              <Card title={t("Historial de entregas", "Delivery history")}>
                {deliveries.length === 0 ? (
                  <p className="text-sm text-slate-500">{t("No hay entregas registradas.", "No deliveries registered.")}</p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {deliveries.map(item => (
                      <li key={item.id}>
                        {formatDateTime(item.delivered_at)} - {item.quantity} {t("unidades", "units")}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {inconsistencies.length > 0 && (
                <Card title={t("Inconsistencias detectadas", "Detected inconsistencies")}>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
                    {inconsistencies.map(item => (
                      <li key={item.id}>
                        {item.name}: stock {item.stock}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}

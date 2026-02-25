"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { useToast } from "@/components/toast/ToastProvider"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import { listRestaurants, Restaurant } from "@/services/restaurants.service"
import {
  createSupply,
  listSupplies,
  listSupplyDeliveries,
  registerSupplyDelivery,
  Supply,
  SupplyDelivery,
} from "@/services/supplies.service"
import { ROLES } from "@/utils/permissions"

function extractError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default function SuppliesPage() {
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { t } = useI18n()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [deliveries, setDeliveries] = useState<SupplyDelivery[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])

  const [supplyName, setSupplyName] = useState("")
  const [supplyUnit, setSupplyUnit] = useState("unit")
  const [supplyStock, setSupplyStock] = useState("0")

  const [deliverySupplyId, setDeliverySupplyId] = useState("")
  const [deliveryRestaurantId, setDeliveryRestaurantId] = useState("")
  const [deliveryQuantity, setDeliveryQuantity] = useState("1")

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [suppliesRows, deliveryRows, restaurantRows] = await Promise.all([
        listSupplies(),
        listSupplyDeliveries(40),
        listRestaurants(),
      ])
      setSupplies(suppliesRows)
      setDeliveries(deliveryRows)
      setRestaurants(restaurantRows)

      setDeliverySupplyId(prev => prev || suppliesRows[0]?.id || "")
      setDeliveryRestaurantId(prev => prev || restaurantRows[0]?.id || "")
    } catch (error: unknown) {
      showToast("error", extractError(error, t("No se pudo cargar el modulo de insumos.", "Could not load supplies module.")))
    } finally {
      setLoading(false)
    }
  }, [showToast, t])

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated || !session?.access_token) return
    void loadData()
  }, [authLoading, isAuthenticated, session?.access_token, loadData])

  const inconsistencies = useMemo(
    () => supplies.filter(item => Number(item.stock ?? 0) < 0),
    [supplies]
  )

  const handleCreateSupply = async () => {
    const parsedStock = Number(supplyStock)
    if (!supplyName.trim() || !Number.isFinite(parsedStock)) {
      showToast("info", t("Completa nombre y stock valido.", "Enter a valid name and stock."))
      return
    }

    try {
      const created = await createSupply({
        name: supplyName.trim(),
        unit: supplyUnit.trim() || "unit",
        stock: parsedStock,
        restaurant_id: null,
      })
      setSupplies(prev => [created, ...prev])
      setSupplyName("")
      setSupplyStock("0")
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
      })
      setDeliveries(prev => [created, ...prev].slice(0, 40))
      showToast("success", t("Entrega registrada.", "Delivery registered."))
    } catch (error: unknown) {
      showToast("error", extractError(error, t("No se pudo registrar la entrega.", "Could not register delivery.")))
    }
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPERVISORA, ROLES.SUPER_ADMIN]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">{t("Insumos", "Supplies")}</h1>

          {loading || authLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <>
              <Card title={t("Crear insumo", "Create supply")} subtitle={t("Agrega un producto base al inventario.", "Add a base product to inventory.")}>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
                  <Button onClick={handleCreateSupply}>{t("Guardar", "Save")}</Button>
                </div>
              </Card>

              <Card title={t("Registrar entrega", "Register delivery")} subtitle={t("Asocia la cantidad entregada a un restaurante.", "Associate delivered quantity to a restaurant.")}>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
                  <Button variant="secondary" onClick={handleRegisterDelivery}>
                    {t("Registrar", "Register")}
                  </Button>
                </div>
              </Card>

              <Card title={t("Inventario actual", "Current inventory")} subtitle={t("Control de stock por insumo.", "Stock control by supply.")}>
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
                        </div>
                      ))}
                    </div>

                    <div className="hidden overflow-x-auto md:block">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-500">
                            <th className="pb-2 pr-3">{t("Nombre", "Name")}</th>
                            <th className="pb-2 pr-3">{t("Unidad", "Unit")}</th>
                            <th className="pb-2 pr-3">{t("Stock", "Stock")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supplies.map(item => (
                            <tr key={item.id} className="border-b border-slate-100">
                              <td className="py-2 pr-3">{item.name}</td>
                              <td className="py-2 pr-3">{item.unit}</td>
                              <td className="py-2 pr-3">{item.stock}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Card>

              <Card title={t("Historial de entregas", "Delivery history")} subtitle={t("Ultimos movimientos registrados.", "Latest registered movements.")}>
                {deliveries.length === 0 ? (
                  <p className="text-sm text-slate-500">{t("No hay entregas registradas.", "No deliveries registered.")}</p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {deliveries.map(item => (
                      <li key={item.id}>
                        {new Date(item.delivered_at).toLocaleString("es-CO")} - {item.quantity} {t("unidades", "units")}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {inconsistencies.length > 0 && (
                <Card title={t("Inconsistencias detectadas", "Detected inconsistencies")} subtitle={t("Se detecto stock negativo.", "Negative stock detected.")}>
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

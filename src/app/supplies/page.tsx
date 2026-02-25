"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
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
      showToast("error", extractError(error, "No se pudo cargar el modulo de insumos."))
    } finally {
      setLoading(false)
    }
  }, [showToast])

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
      showToast("info", "Completa nombre y stock valido.")
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
      showToast("success", "Insumo creado.")
    } catch (error: unknown) {
      showToast("error", extractError(error, "No se pudo crear el insumo."))
    }
  }

  const handleRegisterDelivery = async () => {
    const parsedQuantity = Number(deliveryQuantity)
    if (!deliverySupplyId || !deliveryRestaurantId || !Number.isFinite(parsedQuantity)) {
      showToast("info", "Selecciona insumo, restaurante y cantidad valida.")
      return
    }

    try {
      const created = await registerSupplyDelivery({
        supply_id: deliverySupplyId,
        restaurant_id: deliveryRestaurantId,
        quantity: parsedQuantity,
      })
      setDeliveries(prev => [created, ...prev].slice(0, 40))
      showToast("success", "Entrega registrada.")
    } catch (error: unknown) {
      showToast("error", extractError(error, "No se pudo registrar la entrega."))
    }
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPERVISORA, ROLES.SUPER_ADMIN]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Insumos</h1>

          {loading || authLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <>
              <Card title="Crear insumo" subtitle="Agrega un producto base al inventario.">
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <input
                    value={supplyName}
                    onChange={event => setSupplyName(event.target.value)}
                    placeholder="Nombre"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={supplyUnit}
                    onChange={event => setSupplyUnit(event.target.value)}
                    placeholder="Unidad"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={supplyStock}
                    onChange={event => setSupplyStock(event.target.value)}
                    placeholder="Stock inicial"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <Button onClick={handleCreateSupply}>Guardar</Button>
                </div>
              </Card>

              <Card title="Registrar entrega" subtitle="Asocia la cantidad entregada a un restaurante.">
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
                    placeholder="Cantidad"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <Button variant="secondary" onClick={handleRegisterDelivery}>
                    Registrar
                  </Button>
                </div>
              </Card>

              <Card title="Inventario actual" subtitle="Control de stock por insumo.">
                {supplies.length === 0 ? (
                  <EmptyState
                    title="Sin insumos"
                    description="Crea el primer insumo para comenzar."
                    actionLabel="Recargar"
                    onAction={() => void loadData()}
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2 md:hidden">
                      {supplies.map(item => (
                        <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                          <p className="font-medium text-slate-900">{item.name}</p>
                          <p className="mt-1 text-sm text-slate-600">Unidad: {item.unit}</p>
                          <p className="mt-1 text-sm text-slate-600">Stock: {item.stock}</p>
                        </div>
                      ))}
                    </div>

                    <div className="hidden overflow-x-auto md:block">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-500">
                            <th className="pb-2 pr-3">Nombre</th>
                            <th className="pb-2 pr-3">Unidad</th>
                            <th className="pb-2 pr-3">Stock</th>
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

              <Card title="Historial de entregas" subtitle="Ultimos movimientos registrados.">
                {deliveries.length === 0 ? (
                  <p className="text-sm text-slate-500">No hay entregas registradas.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {deliveries.map(item => (
                      <li key={item.id}>
                        {new Date(item.delivered_at).toLocaleString("es-CO")} - {item.quantity} unidades
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {inconsistencies.length > 0 && (
                <Card title="Inconsistencias detectadas" subtitle="Se detecto stock negativo.">
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

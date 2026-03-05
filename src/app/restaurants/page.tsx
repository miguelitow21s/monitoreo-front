"use client"

import { useCallback, useEffect, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { useToast } from "@/components/toast/ToastProvider"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import {
  assignEmployeeToRestaurant,
  createRestaurant,
  listRestaurantEmployees,
  listRestaurants,
  Restaurant,
  RestaurantEmployee,
  updateRestaurant,
} from "@/services/restaurants.service"
import { listUserProfiles, UserProfile } from "@/services/users.service"
import { ROLES } from "@/utils/permissions"

function parseNullableNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export default function RestaurantsPage() {
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { t } = useI18n()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Restaurant[]>([])
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [assignments, setAssignments] = useState<Record<string, RestaurantEmployee[]>>({})

  const [name, setName] = useState("")
  const [lat, setLat] = useState("")
  const [lng, setLng] = useState("")
  const [radius, setRadius] = useState("100")

  const [assignRestaurant, setAssignRestaurant] = useState("")
  const [assignUser, setAssignUser] = useState("")

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [restaurantRows, profileRows] = await Promise.all([listRestaurants(), listUserProfiles()])
      setRows(restaurantRows)
      setProfiles(profileRows)

      setAssignRestaurant(prev => prev || restaurantRows[0]?.id || "")
      setAssignUser(prev => prev || profileRows[0]?.id || "")

      const assignmentEntries = await Promise.all(
        restaurantRows.slice(0, 8).map(async item => [item.id, await listRestaurantEmployees(item.id)] as const)
      )
      setAssignments(Object.fromEntries(assignmentEntries))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudieron cargar los restaurantes.", "Could not load restaurants."))
    } finally {
      setLoading(false)
    }
  }, [showToast, t])

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated || !session?.access_token) return
    void loadData()
  }, [authLoading, isAuthenticated, session?.access_token, loadData])

  const handleCreate = async () => {
    const parsedLat = parseNullableNumber(lat)
    const parsedLng = parseNullableNumber(lng)
    const parsedRadius = parseNullableNumber(radius)

    if (!name.trim() || parsedLat === null || parsedLng === null || parsedRadius === null) {
      showToast("info", t("Completa nombre, latitud, longitud y radio.", "Complete name, latitude, longitude, and radius."))
      return
    }

    if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
      showToast("info", t("Latitud/longitud fuera de rango valido.", "Latitude/longitude out of valid range."))
      return
    }

    if (parsedRadius <= 0) {
      showToast("info", t("El radio debe ser mayor a 0.", "Radius must be greater than 0."))
      return
    }

    try {
      const created = await createRestaurant({
        name: name.trim(),
        lat: parsedLat,
        lng: parsedLng,
        geofence_radius_m: parsedRadius,
      })
      setRows(prev => [created, ...prev])
      setName("")
      setLat("")
      setLng("")
      showToast("success", t("Restaurante creado.", "Restaurant created."))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo crear el restaurante.", "Could not create restaurant."))
    }
  }

  const handleRadiusUpdate = async (restaurant: Restaurant, newRadius: string) => {
    const parsed = parseNullableNumber(newRadius)
    try {
      const updated = await updateRestaurant(restaurant.id, { geofence_radius_m: parsed })
      setRows(prev => prev.map(item => (item.id === updated.id ? updated : item)))
      showToast("success", t("Geocerca actualizada.", "Geofence updated."))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo actualizar la geocerca.", "Could not update geofence."))
    }
  }

  const handleAssign = async () => {
    if (!assignRestaurant || !assignUser) {
      showToast("info", t("Selecciona restaurante y empleado.", "Select restaurant and employee."))
      return
    }

    try {
      const created = await assignEmployeeToRestaurant(assignRestaurant, assignUser)
      setAssignments(prev => ({
        ...prev,
        [assignRestaurant]: [created, ...(prev[assignRestaurant] ?? [])],
      }))
      showToast("success", t("Empleado asignado al restaurante.", "Employee assigned to restaurant."))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo asignar el empleado.", "Could not assign employee."))
    }
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">{t("Restaurantes", "Restaurants")}</h1>

          {loading || authLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <>
              <Card title={t("Crear restaurante", "Create restaurant")} subtitle={t("Incluye coordenadas y radio de geocerca.", "Include coordinates and geofence radius.")}>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={t("Nombre", "Name")}
                    value={name}
                    onChange={event => setName(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={t("Latitud", "Latitude")}
                    value={lat}
                    onChange={event => setLat(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={t("Longitud", "Longitude")}
                    value={lng}
                    onChange={event => setLng(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={t("Radio (m)", "Radius (m)")}
                    value={radius}
                    onChange={event => setRadius(event.target.value)}
                  />
                  <Button onClick={handleCreate}>{t("Guardar", "Save")}</Button>
                </div>
              </Card>

              <Card title={t("Asignar empleados", "Assign employees")} subtitle={t("Asocia usuarios operativos con restaurantes.", "Associate operational users with restaurants.")}>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={assignRestaurant}
                    onChange={event => setAssignRestaurant(event.target.value)}
                  >
                    {rows.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={assignUser}
                    onChange={event => setAssignUser(event.target.value)}
                  >
                    {profiles
                      .filter(item => item.role === ROLES.EMPLEADO && item.is_active !== false)
                      .map(item => (
                      <option key={item.id} value={item.id}>
                        {item.full_name ?? item.email ?? item.id}
                      </option>
                      ))}
                  </select>
                  <Button variant="secondary" onClick={handleAssign}>
                    {t("Asignar", "Assign")}
                  </Button>
                </div>
              </Card>

              <Card title={t("Listado de restaurantes", "Restaurant list")} subtitle={t("Configuracion operativa actual.", "Current operational configuration.")}>
                {rows.length === 0 ? (
                  <EmptyState
                    title={t("Sin restaurantes", "No restaurants")}
                    description={t("Crea el primer restaurante para iniciar operacion.", "Create the first restaurant to start operations.")}
                    actionLabel={t("Recargar", "Reload")}
                    onAction={() => void loadData()}
                  />
                ) : (
                  <div className="space-y-3">
                    {rows.map(item => (
                      <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-900">{item.name}</p>
                            <p className="text-sm text-slate-600">
                              Lat: {item.lat ?? "-"} | Lng: {item.lng ?? "-"} | {t("Radio", "Radius")}:{" "}
                              {item.geofence_radius_m ?? "-"} m
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              defaultValue={String(item.geofence_radius_m ?? 100)}
                              className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                              onBlur={event => void handleRadiusUpdate(item, event.target.value)}
                            />
                            <span className="text-xs text-slate-500">m</span>
                          </div>
                        </div>
                        {(assignments[item.id] ?? []).length > 0 && (
                          <p className="mt-2 text-xs text-slate-500">
                            {t("Empleados asignados", "Assigned employees")}: {(assignments[item.id] ?? []).length}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}

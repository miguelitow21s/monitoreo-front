"use client"

import { useCallback, useEffect, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
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
      showToast("error", error instanceof Error ? error.message : "Could not load restaurants.")
    } finally {
      setLoading(false)
    }
  }, [showToast])

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
      showToast("info", "Complete name, latitude, longitude and radius.")
      return
    }

    if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
      showToast("info", "Latitude/longitude are out of valid range.")
      return
    }

    if (parsedRadius <= 0) {
      showToast("info", "Radius must be greater than 0.")
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
      showToast("success", "Restaurant created.")
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "Could not create restaurant.")
    }
  }

  const handleRadiusUpdate = async (restaurant: Restaurant, newRadius: string) => {
    const parsed = parseNullableNumber(newRadius)
    try {
      const updated = await updateRestaurant(restaurant.id, { geofence_radius_m: parsed })
      setRows(prev => prev.map(item => (item.id === updated.id ? updated : item)))
      showToast("success", "Geofence updated.")
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "Could not update geofence.")
    }
  }

  const handleAssign = async () => {
    if (!assignRestaurant || !assignUser) {
      showToast("info", "Select restaurant and employee.")
      return
    }

    try {
      const created = await assignEmployeeToRestaurant(assignRestaurant, assignUser)
      setAssignments(prev => ({
        ...prev,
        [assignRestaurant]: [created, ...(prev[assignRestaurant] ?? [])],
      }))
      showToast("success", "Employee assigned to restaurant.")
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "Could not assign employee.")
    }
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Restaurants</h1>

          {loading || authLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <>
              <Card title="Create restaurant" subtitle="Include coordinates and geofence radius.">
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Name"
                    value={name}
                    onChange={event => setName(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Latitude"
                    value={lat}
                    onChange={event => setLat(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Longitude"
                    value={lng}
                    onChange={event => setLng(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Radius (m)"
                    value={radius}
                    onChange={event => setRadius(event.target.value)}
                  />
                  <Button onClick={handleCreate}>Save</Button>
                </div>
              </Card>

              <Card title="Assign employees" subtitle="Associate operational users with restaurants.">
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
                    Assign
                  </Button>
                </div>
              </Card>

              <Card title="Restaurant list" subtitle="Current operational setup.">
                {rows.length === 0 ? (
                  <EmptyState
                    title="No restaurants"
                    description="Create the first restaurant to begin operations."
                    actionLabel="Reload"
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
                              Lat: {item.lat ?? "-"} | Lng: {item.lng ?? "-"} | Radius:{" "}
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
                            Assigned employees: {(assignments[item.id] ?? []).length}
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

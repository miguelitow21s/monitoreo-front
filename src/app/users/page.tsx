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
import { listRestaurants, Restaurant } from "@/services/restaurants.service"
import { assignScheduledShift, listScheduledShifts, ScheduledShift } from "@/services/scheduling.service"
import { listUserProfiles, updateUserProfileRole, updateUserProfileStatus, UserProfile } from "@/services/users.service"
import { ROLES, Role } from "@/utils/permissions"

const roleOptions: Role[] = [ROLES.EMPLEADO, ROLES.SUPERVISORA, ROLES.SUPER_ADMIN]
const roleLabels: Record<Role, string> = {
  [ROLES.EMPLEADO]: "Empleado",
  [ROLES.SUPERVISORA]: "Supervisora",
  [ROLES.SUPER_ADMIN]: "Superadmin",
}

export default function UsersPage() {
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<UserProfile[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [scheduled, setScheduled] = useState<ScheduledShift[]>([])
  const [assigning, setAssigning] = useState(false)
  const [scheduleEmployeeId, setScheduleEmployeeId] = useState("")
  const [scheduleRestaurantId, setScheduleRestaurantId] = useState("")
  const [scheduleStart, setScheduleStart] = useState("")
  const [scheduleEnd, setScheduleEnd] = useState("")
  const [scheduleNotes, setScheduleNotes] = useState("")

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [usersData, restaurantsData, scheduledData] = await Promise.all([
        listUserProfiles(),
        listRestaurants(),
        listScheduledShifts(40),
      ])
      setRows(usersData)
      setRestaurants(restaurantsData)
      setScheduled(scheduledData)

      const employees = usersData.filter(item => item.role === ROLES.EMPLEADO && item.is_active !== false)
      setScheduleEmployeeId(prev => prev || employees[0]?.id || "")
      setScheduleRestaurantId(prev => prev || restaurantsData[0]?.id || "")
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudieron cargar los usuarios.")
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated || !session?.access_token) return
    void loadData()
  }, [authLoading, isAuthenticated, session?.access_token, loadData])

  const handleRoleChange = async (id: string, role: Role) => {
    try {
      const updated = await updateUserProfileRole(id, role)
      setRows(prev => prev.map(item => (item.id === id ? updated : item)))
      showToast("success", "Rol actualizado.")
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudo actualizar el rol.")
    }
  }

  const handleToggleActive = async (id: string, current: boolean | null) => {
    try {
      const updated = await updateUserProfileStatus(id, !(current ?? true))
      setRows(prev => prev.map(item => (item.id === id ? updated : item)))
      showToast("success", "Estado de usuario actualizado.")
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudo actualizar el estado.")
    }
  }

  const handleAssignScheduledShift = async () => {
    if (!scheduleEmployeeId || !scheduleRestaurantId || !scheduleStart || !scheduleEnd) {
      showToast("info", "Completa empleado, restaurante, inicio y fin.")
      return
    }

    const startIso = new Date(scheduleStart).toISOString()
    const endIso = new Date(scheduleEnd).toISOString()

    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      showToast("info", "La hora de fin debe ser posterior a la hora de inicio.")
      return
    }

    setAssigning(true)
    try {
      await assignScheduledShift({
        employeeId: scheduleEmployeeId,
        restaurantId: scheduleRestaurantId,
        scheduledStartIso: startIso,
        scheduledEndIso: endIso,
        notes: scheduleNotes.trim() || undefined,
      })
      showToast("success", "Turno programado correctamente.")
      setScheduleNotes("")
      await loadData()
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudo programar el turno.")
    } finally {
      setAssigning(false)
    }
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Usuarios</h1>

          {loading || authLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <div className="space-y-4">
              <Card title="Gestion de usuarios" subtitle="Asignacion de rol y activacion/desactivacion.">
                {rows.length === 0 ? (
                  <EmptyState
                    title="Sin usuarios"
                    description="No hay perfiles disponibles para gestionar."
                    actionLabel="Recargar"
                    onAction={() => void loadData()}
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2 md:hidden">
                      {rows.map(item => (
                        <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                          <p className="font-medium text-slate-900">{item.full_name ?? "Sin nombre"}</p>
                          <p className="mt-1 break-all text-xs text-slate-500">{item.email ?? "-"}</p>
                          <p className="mt-2 text-xs text-slate-600">
                            Estado: {item.is_active === false ? "Inactivo" : "Activo"}
                          </p>
                          <div className="mt-3 grid gap-2">
                            <select
                              value={item.role ?? ROLES.EMPLEADO}
                              onChange={event => void handleRoleChange(item.id, event.target.value as Role)}
                              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                            >
                              {roleOptions.map(role => (
                                <option key={role} value={role}>
                                  {roleLabels[role]}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void handleToggleActive(item.id, item.is_active)}
                            >
                              {item.is_active === false ? "Activar" : "Desactivar"}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="hidden overflow-x-auto md:block">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-500">
                            <th className="pb-2 pr-3">Usuario</th>
                            <th className="pb-2 pr-3">Correo</th>
                            <th className="pb-2 pr-3">Rol</th>
                            <th className="pb-2 pr-3">Estado</th>
                            <th className="pb-2 pr-3">Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(item => (
                            <tr key={item.id} className="border-b border-slate-100">
                              <td className="py-2 pr-3">{item.full_name ?? "Sin nombre"}</td>
                              <td className="py-2 pr-3">{item.email ?? "-"}</td>
                              <td className="py-2 pr-3">
                                <select
                                  value={item.role ?? ROLES.EMPLEADO}
                                  onChange={event => void handleRoleChange(item.id, event.target.value as Role)}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  {roleOptions.map(role => (
                                    <option key={role} value={role}>
                                      {roleLabels[role]}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2 pr-3">{item.is_active === false ? "Inactivo" : "Activo"}</td>
                              <td className="py-2 pr-3">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => void handleToggleActive(item.id, item.is_active)}
                                >
                                  {item.is_active === false ? "Activar" : "Desactivar"}
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Card>

              <Card title="Programar turno" subtitle="Asigna fecha, hora y restaurante a un empleado activo.">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <select
                    value={scheduleEmployeeId}
                    onChange={event => setScheduleEmployeeId(event.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  >
                    {rows
                      .filter(item => item.role === ROLES.EMPLEADO && item.is_active !== false)
                      .map(item => (
                        <option key={item.id} value={item.id}>
                          {item.full_name ?? item.email ?? item.id}
                        </option>
                      ))}
                  </select>

                  <select
                    value={scheduleRestaurantId}
                    onChange={event => setScheduleRestaurantId(event.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  >
                    {restaurants.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>

                  <input
                    type="datetime-local"
                    value={scheduleStart}
                    onChange={event => setScheduleStart(event.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />

                  <input
                    type="datetime-local"
                    value={scheduleEnd}
                    onChange={event => setScheduleEnd(event.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />

                  <Button onClick={() => void handleAssignScheduledShift()} disabled={assigning}>
                    {assigning ? "Programando..." : "Programar"}
                  </Button>
                </div>

                <textarea
                  value={scheduleNotes}
                  onChange={event => setScheduleNotes(event.target.value)}
                  rows={2}
                  placeholder="Notas del turno (opcional)"
                  className="mt-2 w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                />

                {scheduled.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Turnos programados recientes
                    </p>
                    <div className="space-y-1">
                      {scheduled.slice(0, 8).map(item => (
                        <div key={item.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                          {new Date(item.scheduled_start).toLocaleString("es-CO")} -{" "}
                          {new Date(item.scheduled_end).toLocaleString("es-CO")} | Estado: {item.status}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}

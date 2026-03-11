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
import {
  assignScheduledShift,
  assignScheduledShiftsBulk,
  cancelScheduledShift,
  listScheduledShifts,
  reprogramScheduledShift,
  ScheduledShift,
} from "@/services/scheduling.service"
import { listUserProfiles, updateUserProfileRole, updateUserProfileStatus, UserProfile } from "@/services/users.service"
import { useI18n } from "@/hooks/useI18n"
import { ROLES, Role } from "@/utils/permissions"

const roleOptions: Role[] = [ROLES.EMPLEADO, ROLES.SUPERVISORA, ROLES.SUPER_ADMIN]
const roleLabels: Record<Role, { es: string; en: string }> = {
  [ROLES.EMPLEADO]: { es: "Empleado", en: "Employee" },
  [ROLES.SUPERVISORA]: { es: "Supervisora", en: "Supervisor" },
  [ROLES.SUPER_ADMIN]: { es: "Superadmin", en: "Super Admin" },
}

export default function UsersPage() {
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { formatDateTime, language, t } = useI18n()
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
  const [scheduledLimit, setScheduledLimit] = useState(40)
  const [scheduleBlocks, setScheduleBlocks] = useState<Array<{ id: number; start: string; end: string }>>([])
  const [savingBulk, setSavingBulk] = useState(false)
  const [editingScheduledId, setEditingScheduledId] = useState<number | null>(null)
  const [editScheduledStart, setEditScheduledStart] = useState("")
  const [editScheduledEnd, setEditScheduledEnd] = useState("")
  const [editScheduledNotes, setEditScheduledNotes] = useState("")

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [usersData, restaurantsData, scheduledData] = await Promise.all([
        listUserProfiles(),
        listRestaurants(),
        listScheduledShifts(scheduledLimit),
      ])
      setRows(usersData)
      setRestaurants(restaurantsData)
      setScheduled(scheduledData)

      const employees = usersData.filter(item => item.role === ROLES.EMPLEADO && item.is_active !== false)
      setScheduleEmployeeId(prev => prev || employees[0]?.id || "")
      setScheduleRestaurantId(prev => prev || restaurantsData[0]?.id || "")
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudieron cargar los usuarios.", "Could not load users."))
    } finally {
      setLoading(false)
    }
  }, [scheduledLimit, showToast, t])

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated || !session?.access_token) return
    void loadData()
  }, [authLoading, isAuthenticated, session?.access_token, loadData])

  const handleRoleChange = async (id: string, role: Role) => {
    try {
      const updated = await updateUserProfileRole(id, role)
      setRows(prev => prev.map(item => (item.id === id ? updated : item)))
      showToast("success", t("Rol actualizado.", "Role updated."))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo actualizar el rol.", "Could not update role."))
    }
  }

  const handleToggleActive = async (id: string, current: boolean | null) => {
    try {
      const updated = await updateUserProfileStatus(id, !(current ?? true))
      setRows(prev => prev.map(item => (item.id === id ? updated : item)))
      showToast("success", t("Estado de usuario actualizado.", "User status updated."))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo actualizar el estado.", "Could not update status."))
    }
  }

  const handleAssignScheduledShift = async () => {
    if (!scheduleEmployeeId || !scheduleRestaurantId || !scheduleStart || !scheduleEnd) {
      showToast("info", t("Completa empleado, restaurante, inicio y fin.", "Complete employee, restaurant, start, and end."))
      return
    }

    const startIso = new Date(scheduleStart).toISOString()
    const endIso = new Date(scheduleEnd).toISOString()

    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      showToast("info", t("La hora de fin debe ser posterior a la hora de inicio.", "End time must be after start time."))
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
      showToast("success", t("Turno programado correctamente.", "Shift scheduled successfully."))
      setScheduleNotes("")
      await loadData()
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo programar el turno.", "Could not schedule shift."))
    } finally {
      setAssigning(false)
    }
  }

  const handleAddScheduleBlock = () => {
    setScheduleBlocks(prev => [...prev, { id: Date.now() + Math.floor(Math.random() * 1000), start: "", end: "" }])
  }

  const handleScheduleBlockChange = (blockId: number, key: "start" | "end", value: string) => {
    setScheduleBlocks(prev => prev.map(item => (item.id === blockId ? { ...item, [key]: value } : item)))
  }

  const handleRemoveScheduleBlock = (blockId: number) => {
    setScheduleBlocks(prev => prev.filter(item => item.id !== blockId))
  }

  const handleAssignScheduledShiftBulk = async () => {
    if (!scheduleEmployeeId || !scheduleRestaurantId) {
      showToast("info", t("Selecciona empleado y restaurante.", "Select employee and restaurant."))
      return
    }

    const validBlocks = scheduleBlocks
      .map(item => ({
        startIso: item.start ? new Date(item.start).toISOString() : "",
        endIso: item.end ? new Date(item.end).toISOString() : "",
      }))
      .filter(item => item.startIso && item.endIso)

    if (validBlocks.length === 0) {
      showToast("info", t("Agrega al menos un bloque de fecha/hora valido.", "Add at least one valid date/time block."))
      return
    }

    const hasInvalidRange = validBlocks.some(item => new Date(item.endIso).getTime() <= new Date(item.startIso).getTime())
    if (hasInvalidRange) {
      showToast("info", t("Todos los bloques deben tener fin posterior al inicio.", "All blocks must have end time after start time."))
      return
    }

    setSavingBulk(true)
    try {
      await assignScheduledShiftsBulk({
        employeeId: scheduleEmployeeId,
        restaurantId: scheduleRestaurantId,
        blocks: validBlocks.map(item => ({ scheduledStartIso: item.startIso, scheduledEndIso: item.endIso })),
        notes: scheduleNotes.trim() || undefined,
      })
      showToast("success", t("Turnos en lote programados correctamente.", "Bulk shifts scheduled successfully."))
      setScheduleBlocks([])
      await loadData()
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudieron programar turnos en lote.", "Could not schedule bulk shifts."))
    } finally {
      setSavingBulk(false)
    }
  }

  const handleCancelScheduled = async (item: ScheduledShift) => {
    try {
      await cancelScheduledShift(item.id, item.notes ?? undefined)
      showToast("success", t("Turno cancelado.", "Shift cancelled."))
      await loadData()
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo cancelar el turno.", "Could not cancel shift."))
    }
  }

  const handleStartEditScheduled = (item: ScheduledShift) => {
    setEditingScheduledId(item.id)
    setEditScheduledStart(item.scheduled_start ? new Date(item.scheduled_start).toISOString().slice(0, 16) : "")
    setEditScheduledEnd(item.scheduled_end ? new Date(item.scheduled_end).toISOString().slice(0, 16) : "")
    setEditScheduledNotes(item.notes ?? "")
  }

  const handleSaveReprogramScheduled = async () => {
    if (!editingScheduledId || !editScheduledStart || !editScheduledEnd) {
      showToast("info", t("Completa inicio y fin para reprogramar.", "Fill start and end to reschedule."))
      return
    }
    const startIso = new Date(editScheduledStart).toISOString()
    const endIso = new Date(editScheduledEnd).toISOString()
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      showToast("info", t("La hora de fin debe ser posterior a inicio.", "End time must be after start."))
      return
    }

    try {
      await reprogramScheduledShift({
        scheduledShiftId: editingScheduledId,
        scheduledStartIso: startIso,
        scheduledEndIso: endIso,
        notes: editScheduledNotes,
      })
      showToast("success", t("Turno reprogramado.", "Shift rescheduled."))
      setEditingScheduledId(null)
      setEditScheduledStart("")
      setEditScheduledEnd("")
      setEditScheduledNotes("")
      await loadData()
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo reprogramar el turno.", "Could not reschedule shift."))
    }
  }

  const usersById = new Map(rows.map(item => [item.id, item]))
  const restaurantsById = new Map(restaurants.map(item => [String(item.id), item]))

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">{t("Usuarios", "Users")}</h1>

          {loading || authLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <div className="space-y-4">
              <Card title={t("Gestion de usuarios", "User management")} subtitle={t("Roles y estado.", "Roles and status.")}>
                {rows.length === 0 ? (
                  <EmptyState
                    title={t("Sin usuarios", "No users")}
                    description={t("No hay perfiles disponibles para gestionar.", "No profiles available to manage.")}
                    actionLabel={t("Recargar", "Reload")}
                    onAction={() => void loadData()}
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2 md:hidden">
                      {rows.map(item => (
                        <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                          <p className="font-medium text-slate-900">{item.full_name ?? t("Sin nombre", "No name")}</p>
                          <p className="mt-1 break-all text-xs text-slate-500">{item.email ?? "-"}</p>
                          <p className="mt-2 text-xs text-slate-600">
                            {t("Estado", "Status")}: {item.is_active === false ? t("Inactivo", "Inactive") : t("Activo", "Active")}
                          </p>
                          <div className="mt-3 grid gap-2">
                            <select
                              value={item.role ?? ROLES.EMPLEADO}
                              onChange={event => void handleRoleChange(item.id, event.target.value as Role)}
                              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                            >
                              {roleOptions.map(role => (
                                <option key={role} value={role}>
                                  {roleLabels[role][language]}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void handleToggleActive(item.id, item.is_active)}
                            >
                              {item.is_active === false ? t("Activar", "Enable") : t("Desactivar", "Disable")}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="hidden overflow-x-auto md:block">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-500">
                            <th className="pb-2 pr-3">{t("Usuario", "User")}</th>
                            <th className="pb-2 pr-3">{t("Correo", "Email")}</th>
                            <th className="pb-2 pr-3">{t("Rol", "Role")}</th>
                            <th className="pb-2 pr-3">{t("Estado", "Status")}</th>
                            <th className="pb-2 pr-3">{t("Acciones", "Actions")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(item => (
                            <tr key={item.id} className="border-b border-slate-100">
                              <td className="py-2 pr-3">{item.full_name ?? t("Sin nombre", "No name")}</td>
                              <td className="py-2 pr-3">{item.email ?? "-"}</td>
                              <td className="py-2 pr-3">
                                <select
                                  value={item.role ?? ROLES.EMPLEADO}
                                  onChange={event => void handleRoleChange(item.id, event.target.value as Role)}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  {roleOptions.map(role => (
                                    <option key={role} value={role}>
                                      {roleLabels[role][language]}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2 pr-3">{item.is_active === false ? t("Inactivo", "Inactive") : t("Activo", "Active")}</td>
                              <td className="py-2 pr-3">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => void handleToggleActive(item.id, item.is_active)}
                                >
                                  {item.is_active === false ? t("Activar", "Enable") : t("Desactivar", "Disable")}
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

              <Card title={t("Programar turno", "Schedule shift")} subtitle={t("Fecha, hora y restaurante.", "Date, time, and restaurant.")}>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
                    {assigning ? t("Programando...", "Scheduling...") : t("Programar", "Schedule")}
                  </Button>
                </div>

                <textarea
                  value={scheduleNotes}
                  onChange={event => setScheduleNotes(event.target.value)}
                  rows={2}
                  placeholder={t("Notas del turno (opcional)", "Shift notes (optional)")}
                  className="mt-2 w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                />

                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">{t("Programacion multiple", "Bulk scheduling")}</p>
                  <p className="text-xs text-slate-500">{t("Agrega varios bloques para distintos dias u horas.", "Add multiple blocks for different days or hours.")}</p>

                  <div className="mt-2 space-y-2">
                    {scheduleBlocks.length === 0 && (
                      <p className="text-xs text-slate-500">{t("No hay bloques agregados.", "No blocks added.")}</p>
                    )}
                    {scheduleBlocks.map(block => (
                      <div key={block.id} className="grid gap-2 sm:grid-cols-3">
                        <input
                          type="datetime-local"
                          value={block.start}
                          onChange={event => handleScheduleBlockChange(block.id, "start", event.target.value)}
                          className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                        />
                        <input
                          type="datetime-local"
                          value={block.end}
                          onChange={event => handleScheduleBlockChange(block.id, "end", event.target.value)}
                          className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                        />
                        <Button size="sm" variant="ghost" onClick={() => handleRemoveScheduleBlock(block.id)}>
                          {t("Quitar", "Remove")}
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={handleAddScheduleBlock}>
                      {t("Agregar bloque", "Add block")}
                    </Button>
                    <Button size="sm" onClick={() => void handleAssignScheduledShiftBulk()} disabled={savingBulk}>
                      {savingBulk ? t("Guardando lote...", "Saving bulk...") : t("Programar lote", "Schedule bulk")}
                    </Button>
                  </div>
                </div>

                {scheduled.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {t("Turnos programados recientes", "Recent scheduled shifts")}
                    </p>
                    <div className="space-y-2">
                      {scheduled.slice(0, 12).map(item => {
                        const employee = usersById.get(item.employee_id)
                        const restaurant = restaurantsById.get(String(item.restaurant_id))
                        const editing = editingScheduledId === item.id
                        return (
                          <div key={item.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                            <p className="font-medium text-slate-800">
                              {employee?.full_name ?? employee?.email ?? item.employee_id} - {restaurant?.name ?? `#${item.restaurant_id}`}
                            </p>
                            {!editing ? (
                              <>
                                <p className="text-slate-600">
                                  {formatDateTime(item.scheduled_start)} - {formatDateTime(item.scheduled_end)}
                                </p>
                                <p className="text-xs text-slate-500">{t("Estado", "Status")}: {item.status}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {item.status !== "cancelled" && (
                                    <Button size="sm" variant="ghost" onClick={() => handleStartEditScheduled(item)}>
                                      {t("Reprogramar", "Reschedule")}
                                    </Button>
                                  )}
                                  {item.status !== "cancelled" && (
                                    <Button size="sm" variant="danger" onClick={() => void handleCancelScheduled(item)}>
                                      {t("Cancelar", "Cancel")}
                                    </Button>
                                  )}
                                </div>
                              </>
                            ) : (
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <input
                                  type="datetime-local"
                                  value={editScheduledStart}
                                  onChange={event => setEditScheduledStart(event.target.value)}
                                  className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                                />
                                <input
                                  type="datetime-local"
                                  value={editScheduledEnd}
                                  onChange={event => setEditScheduledEnd(event.target.value)}
                                  className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                                />
                                <textarea
                                  rows={2}
                                  value={editScheduledNotes}
                                  onChange={event => setEditScheduledNotes(event.target.value)}
                                  className="sm:col-span-2 rounded-md border border-slate-300 px-2 py-2 text-sm"
                                  placeholder={t("Notas", "Notes")}
                                />
                                <div className="sm:col-span-2 flex flex-wrap gap-2">
                                  <Button size="sm" variant="primary" onClick={() => void handleSaveReprogramScheduled()}>
                                    {t("Guardar", "Save")}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setEditingScheduledId(null)
                                      setEditScheduledStart("")
                                      setEditScheduledEnd("")
                                      setEditScheduledNotes("")
                                    }}
                                  >
                                    {t("Cerrar", "Close")}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setScheduledLimit(prev => Math.min(prev + 40, 1000))}>
                      {t("Cargar mas historial", "Load more history")}
                    </Button>
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

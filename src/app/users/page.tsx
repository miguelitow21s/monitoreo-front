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
  assignScheduledShiftsBulk,
  cancelScheduledShift,
  listScheduledShifts,
  reprogramScheduledShift,
  ScheduledShift,
} from "@/services/scheduling.service"
import {
  createAdminUser,
  listUserProfiles,
  updateUserProfileRole,
  updateUserProfileStatus,
  UserProfile,
} from "@/services/users.service"
import { useI18n } from "@/hooks/useI18n"
import { ROLES, Role } from "@/utils/permissions"
import { normalizePhoneForOtp } from "@/utils/phone"
import {
  generateScheduleBlocksFromRange,
  getSchedulePresetRange,
  ScheduleQuickPreset,
} from "@/utils/scheduling"

const roleOptions: Role[] = [ROLES.EMPLEADO, ROLES.SUPERVISORA, ROLES.SUPER_ADMIN]
const roleLabels: Record<Role, { es: string; en: string }> = {
  [ROLES.EMPLEADO]: { es: "Empleado", en: "Employee" },
  [ROLES.SUPERVISORA]: { es: "Supervisora", en: "Supervisor" },
  [ROLES.SUPER_ADMIN]: { es: "Superadmin", en: "Super Admin" },
}

function roleRequiresOtpPhone(role: Role | null | undefined) {
  return role === ROLES.EMPLEADO || role === ROLES.SUPERVISORA
}

function escapeCsvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function daysFromToday(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateInputValue(date)
}

function formatRestaurantAddress(restaurant: Restaurant | null | undefined) {
  if (!restaurant) return ""
  return [
    restaurant.address_line,
    restaurant.city,
    restaurant.state,
    restaurant.postal_code,
    restaurant.country,
  ]
    .map(item => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .join(", ")
}

function formatRestaurantLabel(restaurant: Restaurant | null | undefined) {
  if (!restaurant) return ""
  const address = formatRestaurantAddress(restaurant)
  return address ? `${restaurant.name} - ${address}` : restaurant.name
}

export default function UsersPage() {
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { formatDateTime, language, t } = useI18n()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<UserProfile[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [scheduled, setScheduled] = useState<ScheduledShift[]>([])
  const [scheduleEmployeeId, setScheduleEmployeeId] = useState("")
  const [scheduleRestaurantId, setScheduleRestaurantId] = useState("")
  const [scheduleNotes, setScheduleNotes] = useState("")
  const [scheduledLimit, setScheduledLimit] = useState(40)
  const [scheduleBlocks, setScheduleBlocks] = useState<Array<{ id: number; start: string; end: string }>>([])
  const [bulkRangeStart, setBulkRangeStart] = useState("")
  const [bulkRangeEnd, setBulkRangeEnd] = useState("")
  const [bulkStartTime, setBulkStartTime] = useState("08:00")
  const [bulkEndTime, setBulkEndTime] = useState("16:00")
  const [bulkWeekdays, setBulkWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [savingBulk, setSavingBulk] = useState(false)
  const [editingScheduledId, setEditingScheduledId] = useState<number | null>(null)
  const [editScheduledStart, setEditScheduledStart] = useState("")
  const [editScheduledEnd, setEditScheduledEnd] = useState("")
  const [editScheduledNotes, setEditScheduledNotes] = useState("")
  const [newUserFullName, setNewUserFullName] = useState("")
  const [newUserEmail, setNewUserEmail] = useState("")
  const [newUserRole, setNewUserRole] = useState<Role>(ROLES.EMPLEADO)
  const [newUserPhone, setNewUserPhone] = useState("")
  const [creatingUser, setCreatingUser] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [usersData, restaurantsData, scheduledData] = await Promise.all([
        listUserProfiles({ useAdminApi: true }),
        listRestaurants({ useAdminApi: true }),
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

  useEffect(() => {
    if (!bulkRangeStart) setBulkRangeStart(daysFromToday(0))
    if (!bulkRangeEnd) setBulkRangeEnd(daysFromToday(30))
  }, [bulkRangeStart, bulkRangeEnd])

  const handleRoleChange = async (id: string, role: Role) => {
    try {
      const updated = await updateUserProfileRole(id, role)
      setRows(prev => prev.map(item => (item.id === id ? updated : item)))
      showToast("success", t("Rol actualizado.", "Role updated."))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo actualizar el rol.", "Could not update role."))
    }
  }

  const handleCreateUser = async () => {
    const email = newUserEmail.trim()
    const fullName = newUserFullName.trim()
    const phone = newUserPhone.trim()
    const requiresPhone = newUserRole === ROLES.EMPLEADO || newUserRole === ROLES.SUPERVISORA

    if (!email || !fullName) {
      showToast("info", t("Completa nombre completo y correo para crear usuario.", "Fill full name and email to create user."))
      return
    }
    if (requiresPhone && !phone) {
      showToast(
        "info",
        t(
          "Para empleado o supervisora el celular es obligatorio para OTP.",
          "Phone number is required for employee/supervisor OTP."
        )
      )
      return
    }

    const normalizedPhone = phone ? normalizePhoneForOtp(phone) : null
    if (phone && !normalizedPhone) {
      showToast(
        "info",
        t(
          "Ingresa un celular valido con codigo de pais. Ejemplo: +12025550123.",
          "Enter a valid phone number with country code. Example: +12025550123."
        )
      )
      return
    }

    setCreatingUser(true)
    try {
      const created = await createAdminUser({
        email,
        fullName,
        role: newUserRole,
        phoneNumber: normalizedPhone,
      })

      setRows(prev => [created, ...prev])
      setNewUserFullName("")
      setNewUserEmail("")
      setNewUserPhone("")
      setNewUserRole(ROLES.EMPLEADO)
      showToast("success", t("Usuario creado correctamente.", "User created successfully."))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo crear el usuario.", "Could not create user."))
    } finally {
      setCreatingUser(false)
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

  const handleAddScheduleBlock = () => {
    setScheduleBlocks(prev => [...prev, { id: Date.now() + Math.floor(Math.random() * 1000), start: "", end: "" }])
  }

  const handleScheduleBlockChange = (blockId: number, key: "start" | "end", value: string) => {
    setScheduleBlocks(prev => prev.map(item => (item.id === blockId ? { ...item, [key]: value } : item)))
  }

  const handleRemoveScheduleBlock = (blockId: number) => {
    setScheduleBlocks(prev => prev.filter(item => item.id !== blockId))
  }

  const handleToggleBulkWeekday = (day: number) => {
    setBulkWeekdays(prev => {
      if (prev.includes(day)) return prev.filter(item => item !== day)
      return [...prev, day].sort((a, b) => a - b)
    })
  }

  const appendGeneratedScheduleBlocks = (generated: Array<{ startLocal: string; endLocal: string }>) => {
    if (generated.length === 0) {
      showToast("info", t("No se pudieron generar bloques con esos criterios.", "Could not generate schedule blocks with those criteria."))
      return
    }

    let addedCount = 0
    setScheduleBlocks(prev => {
      const seen = new Set(prev.map(item => `${item.start}|${item.end}`))
      const next = [...prev]

      for (const item of generated) {
        const key = `${item.startLocal}|${item.endLocal}`
        if (seen.has(key)) continue
        seen.add(key)
        next.push({
          id: Date.now() + next.length + Math.floor(Math.random() * 1000),
          start: item.startLocal,
          end: item.endLocal,
        })
        addedCount += 1
      }

      return next
    })

    if (addedCount === 0) {
      showToast("info", t("Los bloques ya existian en la lista.", "Those blocks already exist in the list."))
      return
    }

    showToast("success", t(`${addedCount} bloque(s) agregados.`, `${addedCount} block(s) added.`))
  }

  const handleGenerateBlocksFromRange = () => {
    const generated = generateScheduleBlocksFromRange({
      startDate: bulkRangeStart,
      endDate: bulkRangeEnd,
      startTime: bulkStartTime,
      endTime: bulkEndTime,
      weekdays: bulkWeekdays,
      maxEntries: 200,
    })

    appendGeneratedScheduleBlocks(generated)
  }

  const handleApplyBulkPreset = (preset: ScheduleQuickPreset) => {
    const range = getSchedulePresetRange(preset)
    setBulkRangeStart(range.startDate)
    setBulkRangeEnd(range.endDate)
    setBulkWeekdays(range.weekdays)

    const generated = generateScheduleBlocksFromRange({
      startDate: range.startDate,
      endDate: range.endDate,
      startTime: bulkStartTime,
      endTime: bulkEndTime,
      weekdays: range.weekdays,
      maxEntries: 200,
    })

    appendGeneratedScheduleBlocks(generated)
  }

  const handleClearScheduleBlocks = () => {
    setScheduleBlocks([])
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
    if (validBlocks.length > 200) {
      showToast("info", t("El lote permite maximo 200 turnos por envio.", "Bulk scheduling allows a maximum of 200 shifts per request."))
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
  const selectedScheduleEmployee = usersById.get(scheduleEmployeeId)
  const selectedScheduleRestaurant = restaurantsById.get(String(scheduleRestaurantId))
  const selectedScheduleEmployeeLabel =
    selectedScheduleEmployee?.full_name ??
    selectedScheduleEmployee?.email ??
    selectedScheduleEmployee?.id ??
    t("Sin empleado seleccionado", "No employee selected")
  const selectedScheduleRestaurantLabel =
    formatRestaurantLabel(selectedScheduleRestaurant) ||
    selectedScheduleRestaurant?.name ||
    t("Sin restaurante seleccionado", "No restaurant selected")
  const weekdayOptions = [
    { value: 1, label: t("Lun", "Mon") },
    { value: 2, label: t("Mar", "Tue") },
    { value: 3, label: t("Mie", "Wed") },
    { value: 4, label: t("Jue", "Thu") },
    { value: 5, label: t("Vie", "Fri") },
    { value: 6, label: t("Sab", "Sat") },
    { value: 0, label: t("Dom", "Sun") },
  ]
  const otpPhoneMissingRows = rows.filter(item => {
    if (!roleRequiresOtpPhone(item.role)) return false
    return !item.phone_number?.trim()
  })

  const handleExportOtpPendingCsv = () => {
    if (otpPhoneMissingRows.length === 0) {
      showToast("info", t("No hay pendientes de celular OTP.", "No OTP phone pending records."))
      return
    }

    const header = ["user_id", "full_name", "email", "role", "is_active", "phone_number"]
    const lines = otpPhoneMissingRows.map(item =>
      [
        item.id,
        item.full_name ?? "",
        item.email ?? "",
        item.role ?? "",
        String(item.is_active ?? ""),
        item.phone_number ?? "",
      ]
        .map(value => escapeCsvValue(String(value)))
        .join(",")
    )

    const csv = [header.join(","), ...lines].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `otp-phone-pending-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    showToast("success", t("CSV exportado correctamente.", "CSV exported successfully."))
  }

  const handleCopyOtpPendingList = async () => {
    if (otpPhoneMissingRows.length === 0) {
      showToast("info", t("No hay pendientes de celular OTP.", "No OTP phone pending records."))
      return
    }

    const header = ["full_name", "email", "role", "is_active", "phone_number"]
    const lines = otpPhoneMissingRows.map(item =>
      [item.full_name ?? "", item.email ?? "", item.role ?? "", String(item.is_active ?? ""), item.phone_number ?? ""].join("\t")
    )
    const text = [header.join("\t"), ...lines].join("\n")

    try {
      await navigator.clipboard.writeText(text)
      showToast("success", t("Pendientes copiados al portapapeles.", "Pending users copied to clipboard."))
    } catch {
      showToast("error", t("No se pudo copiar al portapapeles.", "Could not copy to clipboard."))
    }
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">{t("Usuarios", "Users")}</h1>

          {loading || authLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <div className="space-y-4">
              <Card
                title={t("Alta de usuario", "Create user")}
                subtitle={t("Crea usuarios operativos sin salir del panel.", "Create operational users directly from this panel.")}
              >
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <input
                    value={newUserFullName}
                    onChange={event => setNewUserFullName(event.target.value)}
                    placeholder={t("Nombre completo", "Full name")}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />
                  <input
                    value={newUserEmail}
                    onChange={event => setNewUserEmail(event.target.value)}
                    type="email"
                    placeholder={t("Correo", "Email")}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />
                  <input
                    value={newUserPhone}
                    onChange={event => setNewUserPhone(event.target.value)}
                    placeholder={
                      newUserRole === ROLES.SUPER_ADMIN
                        ? t("Telefono (opcional)", "Phone (optional)")
                        : t("Telefono +codigo pais (obligatorio OTP)", "Phone +country code (required for OTP)")
                    }
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />
                  <select
                    value={newUserRole}
                    onChange={event => setNewUserRole(event.target.value as Role)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  >
                    {roleOptions.map(role => (
                      <option key={role} value={role}>
                        {roleLabels[role][language]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-3">
                  <Button variant="primary" onClick={() => void handleCreateUser()} disabled={creatingUser}>
                    {creatingUser ? t("Creando...", "Creating...") : t("Crear usuario", "Create user")}
                  </Button>
                </div>
              </Card>

              <Card title={t("Gestion de usuarios", "User management")} subtitle={t("Roles, estado y trazabilidad de celular OTP.", "Roles, status, and OTP phone traceability.")}>
                {otpPhoneMissingRows.length > 0 && (
                  <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p className="font-semibold">
                      {t("Perfiles sin celular para OTP", "Profiles missing OTP phone")}: {otpPhoneMissingRows.length}
                    </p>
                    <p className="mt-1 text-amber-800">
                      {t(
                        "Empleados y supervisoras sin celular no podran completar OTP para iniciar/finalizar turnos.",
                        "Employees and supervisors without phone number cannot complete OTP for shift start/end."
                      )}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={handleExportOtpPendingCsv}>
                        {t("Exportar pendientes CSV", "Export pending CSV")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void handleCopyOtpPendingList()}>
                        {t("Copiar pendientes", "Copy pending list")}
                      </Button>
                    </div>
                  </div>
                )}

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
                          <p className="mt-1 text-xs text-slate-600">
                            {t("Celular", "Phone")}: {item.phone_number?.trim() || "-"}
                          </p>
                          {roleRequiresOtpPhone(item.role) && !item.phone_number?.trim() && (
                            <p className="mt-1 text-xs font-semibold text-amber-700">
                              {t("Falta celular OTP", "Missing OTP phone")}
                            </p>
                          )}
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
                            <th className="pb-2 pr-3">{t("Celular", "Phone")}</th>
                            <th className="pb-2 pr-3">{t("Rol", "Role")}</th>
                            <th className="pb-2 pr-3">{t("OTP", "OTP")}</th>
                            <th className="pb-2 pr-3">{t("Estado", "Status")}</th>
                            <th className="pb-2 pr-3">{t("Acciones", "Actions")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(item => (
                            <tr key={item.id} className="border-b border-slate-100">
                              <td className="py-2 pr-3">{item.full_name ?? t("Sin nombre", "No name")}</td>
                              <td className="py-2 pr-3">{item.email ?? "-"}</td>
                              <td className="py-2 pr-3">{item.phone_number?.trim() || "-"}</td>
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
                              <td className="py-2 pr-3">
                                {roleRequiresOtpPhone(item.role) ? (
                                  item.phone_number?.trim() ? (
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                                      {t("Listo", "Ready")}
                                    </span>
                                  ) : (
                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                                      {t("Falta celular", "Missing phone")}
                                    </span>
                                  )
                                ) : (
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                                    {t("No aplica", "N/A")}
                                  </span>
                                )}
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

              <Card title={t("Programar turno", "Schedule shift")} subtitle={t("Usa programacion multiple para crear uno o varios turnos.", "Use bulk scheduling to create one or multiple shifts.")}>
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">{t("Programacion multiple", "Bulk scheduling")}</p>
                  <p className="text-xs text-slate-500">{t("Genera turnos por rango y dias de semana, o agrega bloques manuales.", "Generate shifts by date range and weekdays, or add manual blocks.")}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <select
                      value={scheduleEmployeeId}
                      onChange={event => setScheduleEmployeeId(event.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                    >
                      <option value="">{t("Seleccionar empleado", "Select employee")}</option>
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
                      <option value="">{t("Seleccionar restaurante", "Select restaurant")}</option>
                      {restaurants.map(item => (
                        <option key={item.id} value={item.id}>
                          {formatRestaurantLabel(item)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                    <p>
                      <span className="font-semibold">{t("Empleado seleccionado", "Selected employee")}:</span> {selectedScheduleEmployeeLabel}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold">{t("Restaurante seleccionado", "Selected restaurant")}:</span> {selectedScheduleRestaurantLabel}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => handleApplyBulkPreset("day")}>
                      {t("1 dia (hoy)", "1 day (today)")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleApplyBulkPreset("week")}>
                      {t("1 semana", "1 week")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleApplyBulkPreset("month")}>
                      {t("1 mes", "1 month")}
                    </Button>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <input
                      type="date"
                      value={bulkRangeStart}
                      onChange={event => setBulkRangeStart(event.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                    />
                    <input
                      type="date"
                      value={bulkRangeEnd}
                      onChange={event => setBulkRangeEnd(event.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                    />
                    <input
                      type="time"
                      value={bulkStartTime}
                      onChange={event => setBulkStartTime(event.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                    />
                    <input
                      type="time"
                      value={bulkEndTime}
                      onChange={event => setBulkEndTime(event.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {weekdayOptions.map(day => {
                      const active = bulkWeekdays.includes(day.value)
                      return (
                        <Button
                          key={day.value}
                          size="sm"
                          variant={active ? "secondary" : "ghost"}
                          onClick={() => handleToggleBulkWeekday(day.value)}
                        >
                          {day.label}
                        </Button>
                      )
                    })}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={handleGenerateBlocksFromRange}>
                      {t("Generar por rango", "Generate by range")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleAddScheduleBlock}>
                      {t("Agregar bloque manual", "Add manual block")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleClearScheduleBlocks}>
                      {t("Limpiar bloques", "Clear blocks")}
                    </Button>
                  </div>

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

                  <textarea
                    value={scheduleNotes}
                    onChange={event => setScheduleNotes(event.target.value)}
                    rows={2}
                    placeholder={t("Notas del turno (opcional)", "Shift notes (optional)")}
                    className="mt-3 w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">
                      {t("Bloques listos", "Ready blocks")}: {scheduleBlocks.length}
                    </span>
                    <Button size="sm" onClick={() => void handleAssignScheduledShiftBulk()} disabled={savingBulk}>
                      {savingBulk
                        ? scheduleBlocks.length === 1
                          ? t("Guardando turno...", "Saving shift...")
                          : t("Guardando turnos...", "Saving shifts...")
                        : scheduleBlocks.length === 1
                          ? t("Programar turno", "Schedule shift")
                          : t("Programar turnos", "Schedule shifts")}
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
                              {employee?.full_name ?? employee?.email ?? item.employee_id} - {formatRestaurantLabel(restaurant) || `#${item.restaurant_id}`}
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

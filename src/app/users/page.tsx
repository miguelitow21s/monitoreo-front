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
  createAdminUser,
  listUserProfiles,
  updateUserProfileRole,
  updateUserProfileStatus,
  UserProfile,
} from "@/services/users.service"
import { useI18n } from "@/hooks/useI18n"
import { ROLES, Role } from "@/utils/permissions"
import { normalizePhoneForOtp } from "@/utils/phone"

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

export default function UsersPage() {
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { language, t } = useI18n()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<UserProfile[]>([])
  const [newUserFullName, setNewUserFullName] = useState("")
  const [newUserEmail, setNewUserEmail] = useState("")
  const [newUserRole, setNewUserRole] = useState<Role>(ROLES.EMPLEADO)
  const [newUserPhone, setNewUserPhone] = useState("")
  const [creatingUser, setCreatingUser] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const usersData = await listUserProfiles({ useAdminApi: true })
      setRows(usersData)
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudieron cargar los usuarios.", "Could not load users."))
    } finally {
      setLoading(false)
    }
  }, [showToast, t])

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
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN, ROLES.SUPERVISORA]}>
        <div className="space-y-4">
          <div className="page-title">{t("Gestión de Empleados", "Employee management")}</div>

          {loading || authLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <div className="space-y-4">
              <Card title={t("Alta de usuario", "Create user")}>
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

              <Card title={t("Gestion de usuarios", "User management")}>
                {otpPhoneMissingRows.length > 0 && (
                  <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p className="font-semibold">
                      {t("Perfiles sin celular para OTP", "Profiles missing OTP phone")}: {otpPhoneMissingRows.length}
                    </p>
                    <p className="mt-1 text-amber-800">
                      {t(
                        "Sin celular OTP no pueden iniciar/finalizar turnos.",
                        "Without OTP phone they cannot start/end shifts."
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
                        <div key={item.id} className="employee-list-item flex-col items-start">
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
                            <button
                              type="button"
                              onClick={() => void handleToggleActive(item.id, item.is_active)}
                              className={`toggle-switch ${item.is_active === false ? "" : "active"}`}
                              aria-label={item.is_active === false ? t("Activar", "Enable") : t("Desactivar", "Disable")}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="hidden overflow-x-auto md:block">
                      <table className="data-table">
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
                                <button
                                  type="button"
                                  onClick={() => void handleToggleActive(item.id, item.is_active)}
                                  className={`toggle-switch ${item.is_active === false ? "" : "active"}`}
                                  aria-label={item.is_active === false ? t("Activar", "Enable") : t("Desactivar", "Disable")}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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



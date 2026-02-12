"use client"

import { useCallback, useEffect, useState } from "react"

import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { useToast } from "@/components/toast/ToastProvider"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import { listUserProfiles, updateUserProfileRole, updateUserProfileStatus, UserProfile } from "@/services/users.service"
import { ROLES, Role } from "@/utils/permissions"

const roleOptions: Role[] = [ROLES.EMPLEADO, ROLES.SUPERVISORA, ROLES.SUPER_ADMIN]

export default function UsersPage() {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<UserProfile[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listUserProfiles()
      setRows(data)
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudo cargar usuarios.")
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleRoleChange = async (id: string, role: Role) => {
    try {
      const updated = await updateUserProfileRole(id, role)
      setRows(prev => prev.map(item => (item.id === id ? updated : item)))
      showToast("success", "Rol actualizado.")
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudo actualizar rol.")
    }
  }

  const handleToggleActive = async (id: string, current: boolean | null) => {
    try {
      const updated = await updateUserProfileStatus(id, !(current ?? true))
      setRows(prev => prev.map(item => (item.id === id ? updated : item)))
      showToast("success", "Estado de usuario actualizado.")
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : "No se pudo actualizar estado.")
    }
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Usuarios</h1>

          {loading ? (
            <Skeleton className="h-28" />
          ) : (
            <Card title="Gestion de usuarios" subtitle="Asignacion de roles y activacion/desactivacion.">
              {rows.length === 0 ? (
                <EmptyState
                  title="Sin usuarios"
                  description="No hay perfiles disponibles para administrar."
                  actionLabel="Recargar"
                  onAction={() => void loadData()}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="pb-2 pr-3">Usuario</th>
                        <th className="pb-2 pr-3">Email</th>
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
                                  {role}
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
              )}
            </Card>
          )}
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}

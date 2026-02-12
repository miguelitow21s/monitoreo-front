"use client"

import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { ROLES } from "@/utils/permissions"

export default function UsersPage() {
  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <div className="p-6 space-y-4">
          <h1 className="text-2xl font-bold">Usuarios</h1>

          <div className="rounded border bg-white p-4">
            <p className="text-sm text-gray-700">
              Gestión de usuarios del sistema: creación, asignación de roles
              y control de acceso.
            </p>

            {/* Base para CRUD real */}
            <div className="mt-4">
              <button className="rounded bg-blue-600 px-4 py-2 text-white">
                Crear usuario
              </button>
            </div>
          </div>
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}
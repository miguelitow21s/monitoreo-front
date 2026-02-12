"use client"

import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { ROLES } from "@/utils/permissions"

export default function UsersPage() {
  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Usuarios</h1>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-600">
              Gestion de usuarios, asignacion de roles y control de acceso.
            </p>
            <button className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
              Crear usuario
            </button>
          </div>
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}

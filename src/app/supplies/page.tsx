"use client"

import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { ROLES } from "@/utils/permissions"

export default function SuppliesPage() {
  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPERVISORA]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Insumos</h1>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-600">
              Registro y control de entrega de insumos por restaurante.
            </p>
            <button className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
              Registrar entrega
            </button>
          </div>
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}

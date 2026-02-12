"use client"

import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { ROLES } from "@/utils/permissions"

export default function ReportsPage() {
  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Reportes</h1>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-600">
              Generacion y descarga de reportes oficiales en PDF y Excel.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                Descargar PDF
              </button>
              <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
                Descargar Excel
              </button>
            </div>
          </div>
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}

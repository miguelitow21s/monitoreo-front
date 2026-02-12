"use client"

import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { ROLES } from "@/utils/permissions"

export default function ReportsPage() {
  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <div className="p-6 space-y-4">
          <h1 className="text-2xl font-bold">Reportes</h1>

          <div className="rounded border p-4 bg-white">
            <p className="text-sm text-gray-700">
              Generación y descarga de reportes oficiales en PDF y Excel.
            </p>

            {/* Aquí luego conectas generación real */}
            <div className="mt-4 space-x-2">
              <button className="rounded bg-blue-600 px-4 py-2 text-white">
                Descargar PDF
              </button>
              <button className="rounded bg-green-600 px-4 py-2 text-white">
                Descargar Excel
              </button>
            </div>
          </div>
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}
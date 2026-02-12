"use client"

import ProtectedRoute from "@/components/ProtectedRoute"
import { useRole } from "@/hooks/useRole"

export default function DashboardPage() {
  const {
    loading,
    isEmpleado,
    isSupervisora,
    isSuperAdmin,
  } = useRole()

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center text-sm text-gray-500">
        Cargando dashboard…
      </div>
    )
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">
          Dashboard
        </h1>

        <div className="grid gap-4 md:grid-cols-3">
          {isEmpleado && (
            <div className="rounded-lg bg-white p-5 shadow">
              <h2 className="mb-2 font-semibold text-gray-700">
                Empleado
              </h2>
              <p className="text-sm text-gray-600">
                Inicia y finaliza tus turnos asignados.
              </p>
            </div>
          )}

          {isSupervisora && (
            <div className="rounded-lg bg-white p-5 shadow">
              <h2 className="mb-2 font-semibold text-gray-700">
                Supervisión
              </h2>
              <p className="text-sm text-gray-600">
                Controla turnos activos e incidencias.
              </p>
            </div>
          )}

          {isSuperAdmin && (
            <div className="rounded-lg bg-white p-5 shadow">
              <h2 className="mb-2 font-semibold text-gray-700">
                Administración
              </h2>
              <p className="text-sm text-gray-600">
                Gestiona restaurantes, usuarios y reportes.
              </p>
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}
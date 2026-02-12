"use client"

import Link from "next/link"
import { useAuth } from "@/hooks/useAuth"

export default function UnauthorizedPage() {
  const { logout } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md rounded bg-white p-8 text-center shadow">
        <h1 className="mb-4 text-2xl font-bold text-red-600">
          Acceso no autorizado
        </h1>

        <p className="mb-6 text-sm text-gray-700">
          No tienes permisos para acceder a esta sección.
        </p>

        <div className="flex flex-col gap-3">
          <Link
            href="/dashboard"
            className="rounded bg-blue-600 px-4 py-2 text-white"
          >
            Volver al dashboard
          </Link>

          <button
            onClick={logout}
            className="rounded bg-gray-200 px-4 py-2 text-sm text-gray-700"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}
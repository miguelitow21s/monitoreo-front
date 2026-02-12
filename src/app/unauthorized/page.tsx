"use client"

import Link from "next/link"

import { useAuth } from "@/hooks/useAuth"

export default function UnauthorizedPage() {
  const { logout } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Acceso no autorizado</h1>
        <p className="mt-3 text-sm text-slate-600">
          Tu rol actual no tiene permisos para esta seccion.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Volver al dashboard
          </Link>
          <button
            onClick={logout}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Cerrar sesion
          </button>
        </div>
      </div>
    </div>
  )
}

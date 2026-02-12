"use client"

import { useMemo } from "react"

import { useAuth } from "@/hooks/useAuth"
import { useRole } from "@/hooks/useRole"

type HeaderProps = {
  collapsed: boolean
  onToggleDesktop: () => void
  onToggleMobile: () => void
}

const roleLabel: Record<string, string> = {
  super_admin: "Super Admin",
  supervisora: "Supervisora",
  empleado: "Empleado",
}

export default function Header({
  collapsed,
  onToggleDesktop,
  onToggleMobile,
}: HeaderProps) {
  const { user, logout } = useAuth()
  const { role } = useRole()

  const leftClass = collapsed ? "md:left-20" : "md:left-64"
  const emailLabel = useMemo(() => user?.email ?? "Sin usuario", [user?.email])
  const roleText = role ? roleLabel[role] ?? role : "Sin rol"

  return (
    <header
      className={`fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 shadow-sm backdrop-blur ${leftClass}`}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleMobile}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 md:hidden"
          aria-label="Abrir menu"
        >
          ==
        </button>
        <button
          onClick={onToggleDesktop}
          className="hidden h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 md:inline-flex"
          aria-label="Expandir o colapsar sidebar"
        >
          {collapsed ? ">>" : "<<"}
        </button>
        <div>
          <h1 className="text-sm font-semibold text-slate-900 md:text-base">
            Plataforma de Control Operativo
          </h1>
          <p className="text-xs text-slate-500">Monitoreo de turnos y supervision</p>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <div className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 sm:block">
          {roleText}
        </div>
        <div className="hidden text-right sm:block">
          <p className="max-w-[220px] truncate text-xs font-medium text-slate-700">
            {emailLabel}
          </p>
        </div>
        <button
          onClick={logout}
          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
        >
          Salir
        </button>
      </div>
    </header>
  )
}

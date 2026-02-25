"use client"

import Link from "next/link"
import { useMemo } from "react"

import { useAuth } from "@/hooks/useAuth"
import { useRole } from "@/hooks/useRole"

type HeaderProps = {
  collapsed: boolean
  onToggleDesktop: () => void
  onToggleMobile: () => void
}

const roleLabel: Record<string, string> = {
  super_admin: "Superadmin",
  supervisora: "Supervisora",
  empleado: "Empleado",
  restaurant_owner: "Dueno de restaurante",
  restaurant_admin: "Administrador de restaurante",
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
      className={`fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/90 px-3 shadow-[0_1px_0_rgba(15,23,42,0.06)] backdrop-blur sm:px-4 ${leftClass}`}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleMobile}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 md:hidden"
          aria-label="Abrir menu"
        >
          <span className="text-base">|||</span>
        </button>
        <button
          onClick={onToggleDesktop}
          className="hidden h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 md:inline-flex"
          aria-label="Expandir o contraer menu lateral"
        >
          {collapsed ? ">>" : "<<"}
        </button>
        <div>
          <h1 className="max-w-[180px] truncate text-sm font-semibold text-slate-900 md:max-w-none md:text-base">
            Plataforma de Control Operativo
          </h1>
          <p className="hidden text-xs text-slate-500 md:block">Trazabilidad de turnos y supervision en campo</p>
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
          className="rounded-lg bg-slate-900 px-2.5 py-2 text-[11px] font-semibold text-white transition hover:bg-slate-700 md:px-3 md:text-xs"
        >
          Cerrar sesion
        </button>
        <Link
          href="/account/password"
          className="rounded-lg border border-slate-300 px-2.5 py-2 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 md:px-3 md:text-xs"
        >
          Contrasena
        </Link>
      </div>
    </header>
  )
}

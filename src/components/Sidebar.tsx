"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { Dispatch, SetStateAction } from "react"

import { useRole } from "@/hooks/useRole"

type SidebarProps = {
  collapsed: boolean
  mobileOpen: boolean
  onToggle: Dispatch<SetStateAction<boolean>>
  onCloseMobile: () => void
}

type NavItem = {
  href: string
  label: string
  icon: string
}

export default function Sidebar({
  collapsed,
  mobileOpen,
  onToggle,
  onCloseMobile,
}: SidebarProps) {
  const pathname = usePathname()
  const { isEmpleado, isSupervisora, isSuperAdmin, loading } = useRole()

  const items: NavItem[] = [{ href: "/dashboard", label: "Dashboard", icon: "DB" }]

  if (isEmpleado) {
    items.push({ href: "/shifts", label: "Mi turno", icon: "TR" })
  }

  if (isSupervisora) {
    items.push({ href: "/shifts", label: "Turnos", icon: "TN" })
    items.push({ href: "/supplies", label: "Insumos", icon: "IN" })
  }

  if (isSuperAdmin) {
    items.push({ href: "/restaurants", label: "Restaurantes", icon: "RS" })
    items.push({ href: "/users", label: "Usuarios", icon: "US" })
    items.push({ href: "/reports", label: "Reportes", icon: "RP" })
  }

  const desktopWidth = collapsed ? "md:w-20" : "md:w-64"
  const mobileTranslate = mobileOpen ? "translate-x-0" : "-translate-x-full"

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-950/35 transition-opacity md:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onCloseMobile}
        aria-hidden="true"
      />

      <aside
        className={`fixed left-0 top-0 z-50 h-screen w-72 transform border-r border-slate-200 bg-white transition-all duration-300 md:top-16 md:z-40 md:h-[calc(100vh-4rem)] md:translate-x-0 ${desktopWidth} ${mobileTranslate}`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3 md:hidden">
            <p className="text-sm font-semibold text-slate-800">Menu</p>
            <button
              onClick={onCloseMobile}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
            >
              Cerrar
            </button>
          </div>

          <div className="hidden px-3 py-3 md:block">
            <button
              onClick={() => onToggle(v => !v)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 transition hover:bg-slate-100"
            >
              {collapsed ? "Expandir" : "Colapsar"}
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-4 pt-2">
            {loading && (
              <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">
                Cargando menu...
              </div>
            )}

            {!loading &&
              items.map(item => {
                const active = pathname.startsWith(item.href)
                const compact = collapsed ? "md:justify-center md:px-0" : ""
                const title = collapsed ? item.label : undefined
                return (
                  <Link
                    key={`${item.href}-${item.label}`}
                    href={item.href}
                    title={title}
                    onClick={onCloseMobile}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${compact} ${
                      active
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-current/20 text-[10px] font-bold">
                      {item.icon}
                    </span>
                    <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
                  </Link>
                )
              })}
          </nav>
        </div>
      </aside>
    </>
  )
}

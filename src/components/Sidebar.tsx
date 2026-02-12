"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { Dispatch, SetStateAction } from "react"

import { useRole } from "@/hooks/useRole"

type SidebarProps = {
  collapsed: boolean
  onToggle: Dispatch<SetStateAction<boolean>>
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const { isEmpleado, isSupervisora, isSuperAdmin, loading } = useRole()

  if (loading) return null

  const linkClass = (path: string) =>
    `flex items-center rounded px-3 py-2 text-sm transition ${
      pathname.startsWith(path)
        ? "bg-blue-600 text-white"
        : "text-gray-700 hover:bg-gray-200"
    } ${collapsed ? "justify-center" : ""}`

  const labelClass = collapsed ? "hidden" : "ml-2"

  return (
    <aside
      className={`fixed left-0 top-16 z-40 h-[calc(100vh-4rem)] border-r bg-white transition-all ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      <button
        onClick={() => onToggle(v => !v)}
        className="m-2 rounded bg-gray-100 p-2 text-sm"
        aria-label="Toggle menu"
      >
        Menu
      </button>

      <nav className="mt-4 space-y-1 px-2">
        <Link href="/dashboard" className={linkClass("/dashboard")}>
          <span className={labelClass}>Dashboard</span>
        </Link>

        {isEmpleado && (
          <Link href="/shifts" className={linkClass("/shifts")}>
            <span className={labelClass}>Mi turno</span>
          </Link>
        )}

        {isSupervisora && (
          <>
            <Link href="/shifts" className={linkClass("/shifts")}>
              <span className={labelClass}>Turnos</span>
            </Link>
            <Link href="/supplies" className={linkClass("/supplies")}>
              <span className={labelClass}>Insumos</span>
            </Link>
          </>
        )}

        {isSuperAdmin && (
          <>
            <Link href="/restaurants" className={linkClass("/restaurants")}>
              <span className={labelClass}>Restaurantes</span>
            </Link>
            <Link href="/users" className={linkClass("/users")}>
              <span className={labelClass}>Usuarios</span>
            </Link>
            <Link href="/reports" className={linkClass("/reports")}>
              <span className={labelClass}>Reportes</span>
            </Link>
          </>
        )}
      </nav>
    </aside>
  )
}

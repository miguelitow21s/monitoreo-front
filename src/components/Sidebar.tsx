"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { Dispatch, ReactNode, SetStateAction } from "react"

import { useLanguage } from "@/context/LanguageContext"
import { useRole } from "@/hooks/useRole"

type SidebarProps = {
  collapsed: boolean
  mobileOpen: boolean
  onToggle: Dispatch<SetStateAction<boolean>>
  onCloseMobile: () => void
}

type NavKey = "dashboard" | "shifts" | "supplies" | "restaurants" | "users" | "reports"

type NavItem = {
  href: string
  label: string
  key: NavKey
}

function Icon({ name }: { name: NavKey }) {
  const base = "h-4 w-4"

  if (name === "dashboard") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={base}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="4" rx="1" />
        <rect x="14" y="10" width="7" height="11" rx="1" />
        <rect x="3" y="13" width="7" height="8" rx="1" />
      </svg>
    )
  }

  if (name === "shifts") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={base}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    )
  }

  if (name === "supplies") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={base}>
        <path d="M3 7h18" />
        <path d="M5 7l1 13h12l1-13" />
        <path d="M9 7V4h6v3" />
      </svg>
    )
  }

  if (name === "restaurants") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={base}>
        <path d="M4 21V10l8-6 8 6v11" />
        <path d="M9 21v-6h6v6" />
      </svg>
    )
  }

  if (name === "users") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={base}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <path d="M17 11a3 3 0 1 0 0-6" />
        <path d="M21 20a5 5 0 0 0-4-5" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={base}>
      <path d="M4 5h16v14H4z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  )
}

function Tooltip({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null
  return (
    <span className="pointer-events-none absolute left-[calc(100%+0.75rem)] top-1/2 hidden -translate-y-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-lg md:block">
      {children}
    </span>
  )
}

export default function Sidebar({
  collapsed,
  mobileOpen,
  onToggle,
  onCloseMobile,
}: SidebarProps) {
  const pathname = usePathname()
  const { isEmpleado, isSupervisora, isSuperAdmin, loading } = useRole()
  const { language } = useLanguage()
  const t = (es: string, en: string) => (language === "en" ? en : es)

  const items: NavItem[] = [{ href: "/dashboard", label: t("Panel", "Dashboard"), key: "dashboard" }]

  if (isEmpleado) {
    items.push({ href: "/shifts", label: t("Mi turno", "My shift"), key: "shifts" })
  }

  if (isSupervisora) {
    items.push({ href: "/shifts", label: t("Turnos", "Shifts"), key: "shifts" })
    items.push({ href: "/supplies", label: t("Insumos", "Supplies"), key: "supplies" })
  }

  if (isSuperAdmin) {
    items.push({ href: "/restaurants", label: t("Restaurantes", "Restaurants"), key: "restaurants" })
    items.push({ href: "/users", label: t("Usuarios", "Users"), key: "users" })
    items.push({ href: "/reports", label: t("Reportes", "Reports"), key: "reports" })
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
        className={`fixed left-0 top-0 z-50 h-screen w-72 transform border-r border-slate-200/90 bg-white/95 backdrop-blur transition-all duration-300 md:top-16 md:z-40 md:h-[calc(100vh-4rem)] md:translate-x-0 ${desktopWidth} ${mobileTranslate}`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3 md:hidden">
            <p className="text-sm font-semibold text-slate-800">{t("Menu", "Menu")}</p>
            <button
              onClick={onCloseMobile}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
            >
              {t("Cerrar", "Close")}
            </button>
          </div>

          <div className="hidden px-3 py-3 md:block">
            <button
              onClick={() => onToggle(v => !v)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 transition hover:bg-slate-100"
            >
              {collapsed ? t("Expandir", "Expand") : t("Contraer", "Collapse")}
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-5 pt-2">
            {loading && (
              <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">{t("Cargando menu...", "Loading menu...")}</div>
            )}

            {!loading &&
              items.map(item => {
                const active = pathname.startsWith(item.href)
                const compact = collapsed ? "md:justify-center md:px-0" : ""
                const showTooltip = collapsed

                return (
                  <Link
                    key={`${item.href}-${item.label}`}
                    href={item.href}
                    onClick={onCloseMobile}
                    className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${compact} ${
                      active
                        ? "bg-slate-900 text-white shadow-md shadow-slate-900/25"
                        : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <span
                      className={`absolute bottom-1 top-1 left-0 w-1 rounded-r-full transition ${
                        active ? "bg-cyan-300" : "bg-transparent group-hover:bg-slate-300"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-current/20">
                      <Icon name={item.key} />
                    </span>
                    <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
                    <Tooltip show={showTooltip}>{item.label}</Tooltip>
                  </Link>
                )
              })}
          </nav>
        </div>
      </aside>
    </>
  )
}

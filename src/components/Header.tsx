"use client"

import Link from "next/link"

import LanguageSwitch from "@/components/LanguageSwitch"
import { useLanguage } from "@/context/LanguageContext"
import { useAuth } from "@/hooks/useAuth"
import { useRole } from "@/hooks/useRole"

type HeaderProps = {
  collapsed: boolean
  onToggleDesktop: () => void
  onToggleMobile: () => void
}

const roleLabel: Record<string, { es: string; en: string }> = {
  super_admin: { es: "Superadmin", en: "Super Admin" },
  supervisora: { es: "Supervisora", en: "Supervisor" },
  empleado: { es: "Empleado", en: "Employee" },
  restaurant_owner: { es: "Dueno de restaurante", en: "Restaurant owner" },
  restaurant_admin: { es: "Administrador de restaurante", en: "Restaurant admin" },
}

export default function Header({
  collapsed,
  onToggleDesktop,
  onToggleMobile,
}: HeaderProps) {
  const { user, logout } = useAuth()
  const { role } = useRole()
  const { language } = useLanguage()

  const leftClass = collapsed ? "md:left-20" : "md:left-64"
  const t = (es: string, en: string) => (language === "en" ? en : es)
  const emailLabel = user?.email ?? t("Sin usuario", "No user")
  const roleText = role ? roleLabel[role]?.[language] ?? role : t("Sin rol", "No role")

  return (
    <header
      className={`fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-4 ${leftClass}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onToggleMobile}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 md:hidden"
          aria-label={t("Abrir menu", "Open menu")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <button
          onClick={onToggleDesktop}
          className="hidden h-9 w-9 items-center justify-center rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 md:inline-flex"
          aria-label={t("Expandir o contraer menu lateral", "Expand or collapse sidebar")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
          </svg>
        </button>
        <div className="min-w-0">
          <h1 className="max-w-[170px] truncate text-sm font-semibold text-slate-900 md:max-w-none md:text-[15px]">
            {t("Plataforma de Control Operativo", "Operations Control Platform")}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-2.5">
        <div className="hidden md:block">
          <LanguageSwitch compact />
        </div>
        <div className="hidden rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 sm:block">
          {roleText}
        </div>
        <div className="hidden text-right sm:block">
          <p className="max-w-[180px] truncate text-xs font-medium text-slate-600">
            {emailLabel}
          </p>
        </div>
        <button
          onClick={logout}
          className="rounded-xl border border-slate-900 bg-slate-900 px-2.5 py-2 text-[11px] font-semibold text-white transition hover:bg-slate-800 md:px-3 md:text-xs"
        >
          {t("Cerrar sesion", "Sign out")}
        </button>
        <Link
          href="/account/password"
          className="rounded-xl border border-slate-300 px-2.5 py-2 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 md:px-3 md:text-xs"
        >
          {t("Contrasena", "Password")}
        </Link>
      </div>
    </header>
  )
}

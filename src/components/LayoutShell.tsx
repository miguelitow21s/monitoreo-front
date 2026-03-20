"use client"

import { useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"

type LayoutShellProps = {
  children: React.ReactNode
}

export default function LayoutShell({ children }: LayoutShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { t } = useI18n()
  const { logout, user, loading: authLoading } = useAuth()
  const { isEmpleado, isSupervisora, isSuperAdmin, loading: roleLoading } = useRole()

  const standalonePage =
    pathname === "/" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/unauthorized") ||
    pathname.startsWith("/clean-control")

  if (standalonePage) {
    return <>{children}</>
  }

  const employeeProfileActive =
    pathname.startsWith("/shifts") && searchParams?.get("view") === "profile"
  const employeeHomeActive = pathname === "/dashboard"

  const supervisorMode = searchParams?.get("supervisor")
  const supervisorHomeActive = pathname.startsWith("/shifts") && supervisorMode !== "presence"
  const supervisorReportsActive = pathname.startsWith("/reports")
  const superAdminReportsActive = pathname.startsWith("/reports")

  const navItems = useMemo(() => {
    if (isEmpleado) {
      return [
        {
          key: "home",
          label: t("Inicio", "Home"),
          icon: "🏠",
          href: "/dashboard",
          active: employeeHomeActive,
        },
        {
          key: "profile",
          label: t("Perfil", "Profile"),
          icon: "👤",
          href: "/shifts?view=profile",
          active: employeeProfileActive,
        },
        {
          key: "logout",
          label: t("Salir", "Sign out"),
          icon: "🚪",
          action: "logout" as const,
        },
      ]
    }

    if (isSupervisora) {
      return [
        {
          key: "home",
          label: t("Inicio", "Home"),
          icon: "🏠",
          href: "/shifts",
          active: supervisorHomeActive,
        },
        {
          key: "supervise",
          label: t("Supervisar", "Supervise"),
          icon: "✅",
          href: "/shifts?supervisor=presence",
          active: supervisorMode === "presence",
        },
        {
          key: "logout",
          label: t("Salir", "Sign out"),
          icon: "🚪",
          action: "logout" as const,
        },
      ]
    }

    if (isSuperAdmin) {
      return [
        {
          key: "home",
          label: t("Inicio", "Home"),
          icon: "🏠",
          href: "/dashboard",
          active: pathname === "/dashboard",
        },
        {
          key: "reports",
          label: t("Reportes", "Reports"),
          icon: "📊",
          href: "/reports",
          active: superAdminReportsActive,
        },
        {
          key: "logout",
          label: t("Salir", "Sign out"),
          icon: "🚪",
          action: "logout" as const,
        },
      ]
    }

    return []
  }, [
    employeeHomeActive,
    employeeProfileActive,
    isEmpleado,
    isSuperAdmin,
    isSupervisora,
    pathname,
    searchParams,
    supervisorHomeActive,
    supervisorMode,
    superAdminReportsActive,
    t,
  ])

  const showChrome = !authLoading && !roleLoading && !!user
  const brandLabel = isSuperAdmin
    ? "WorkTrace Admin"
    : isSupervisora
      ? "WorkTrace Supervisor"
      : "WorkTrace"

  return (
    <div className="wt-app min-h-screen">
      {showChrome && (
        <header className="header">
          <div className="header-brand">
            <span className="header-brand-icon">WT</span>
            <span>{brandLabel}</span>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="header-btn"
              onClick={() => {
                // Placeholder for notifications
              }}
              aria-label={t("Notificaciones", "Notifications")}
            >
              🔔
            </button>
          </div>
        </header>
      )}

      <main className="content">{children}</main>

      {showChrome && navItems.length > 0 && (
        <nav className="bottom-nav">
          {navItems.map(item => {
            const active = item.active
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (item.action === "logout") {
                    logout()
                    return
                  }
                  if (item.href) router.push(item.href)
                }}
                className={["nav-item", active ? "active" : ""].join(" ")}
              >
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
      )}
    </div>
  )
}

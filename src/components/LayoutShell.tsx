"use client"

import { useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"

type LayoutShellProps = {
  children: React.ReactNode
}

type NavIconKey = "home" | "profile" | "logout" | "supervise" | "reports"

function NavIcon({ icon }: { icon: NavIconKey }) {
  if (icon === "home") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.8V21h14V9.8" />
      </svg>
    )
  }

  if (icon === "profile") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20a8 8 0 0 1 16 0" />
      </svg>
    )
  }

  if (icon === "supervise") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 12l2 2 4-4" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    )
  }

  if (icon === "reports") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 20h16" />
        <path d="M7 16v-5" />
        <path d="M12 16v-9" />
        <path d="M17 16v-3" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <path d="M4 6l2 2 3-3" />
      <path d="M4 12l2 2 3-3" />
      <path d="M4 18l2 2 3-3" />
    </svg>
  )
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
          icon: "home" as const,
          href: "/dashboard",
          active: employeeHomeActive,
        },
        {
          key: "profile",
          label: t("Perfil", "Profile"),
          icon: "profile" as const,
          href: "/shifts?view=profile",
          active: employeeProfileActive,
        },
        {
          key: "logout",
          label: t("Salir", "Sign out"),
          icon: "logout" as const,
          action: "logout" as const,
        },
      ]
    }

    if (isSupervisora) {
      return [
        {
          key: "home",
          label: t("Inicio", "Home"),
          icon: "home" as const,
          href: "/shifts?supervisor=home",
          active: supervisorHomeActive,
        },
        {
          key: "supervise",
          label: t("Supervisar", "Supervise"),
          icon: "supervise" as const,
          href: "/shifts?supervisor=presence",
          active: supervisorMode === "presence",
        },
        {
          key: "logout",
          label: t("Salir", "Sign out"),
          icon: "logout" as const,
          action: "logout" as const,
        },
      ]
    }

    if (isSuperAdmin) {
      return [
        {
          key: "home",
          label: t("Inicio", "Home"),
          icon: "home" as const,
          href: "/dashboard",
          active: pathname === "/dashboard",
        },
        {
          key: "reports",
          label: t("Reportes", "Reports"),
          icon: "reports" as const,
          href: "/reports",
          active: superAdminReportsActive,
        },
        {
          key: "logout",
          label: t("Salir", "Sign out"),
          icon: "logout" as const,
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

  if (standalonePage) {
    return <>{children}</>
  }

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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
                <path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
                <path d="M10 20a2 2 0 0 0 4 0" />
              </svg>
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
                <span className="nav-icon">
                  <NavIcon icon={item.icon} />
                </span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
      )}
    </div>
  )
}

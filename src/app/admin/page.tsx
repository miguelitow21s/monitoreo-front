"use client"

import { useRouter } from "next/navigation"
import { Manrope } from "next/font/google"

import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { useI18n } from "@/hooks/useI18n"
import { ROLES } from "@/utils/permissions"

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
})

type AdminActionIconKey = "shifts" | "users" | "config" | "audit"

function AdminActionIcon({ name }: { name: AdminActionIconKey }) {
  if (name === "shifts") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4" />
        <path d="M16 3v4" />
        <path d="M3 10h18" />
      </svg>
    )
  }

  if (name === "users") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="9" r="3" />
        <circle cx="17" cy="10" r="2" />
        <path d="M3 19a6 6 0 0 1 12 0" />
        <path d="M14 19a4 4 0 0 1 7 0" />
      </svg>
    )
  }

  if (name === "config") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c0 .7.4 1.3 1.1 1.5H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 7h11" />
      <path d="M9 12h11" />
      <path d="M9 17h11" />
      <path d="M4 7h.01" />
      <path d="M4 12h.01" />
      <path d="M4 17h.01" />
    </svg>
  )
}

export default function AdminPage() {
  const router = useRouter()
  const { t } = useI18n()
  const quickActions = [
    {
      key: "supervisorView",
      label: t("Funciones Supervisor", "Supervisor tools"),
      icon: "shifts" as const,
      href: "/shifts?supervisor=home",
    },
    {
      key: "supervisors",
      label: t("Gestionar Supervisores", "Manage supervisors"),
      icon: "users" as const,
      href: "/users",
    },
    {
      key: "config",
      label: t("Configuración", "Configuration"),
      icon: "config" as const,
      href: "/account/password",
    },
    {
      key: "audit",
      label: t("Auditoría", "Audit"),
      icon: "audit" as const,
      href: "/reports",
    },
  ]

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <section className={`space-y-5 ${manrope.className}`}>
          <div className="page-title">{t("Panel de Superusuario", "Superuser panel")}</div>

          <div className="quick-actions">
            {quickActions.map(action => (
              <button key={action.key} className="quick-action-btn" onClick={() => router.push(action.href)}>
                <span className="quick-action-icon">
                  <AdminActionIcon name={action.icon} />
                </span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </section>
      </RoleGuard>
    </ProtectedRoute>
  )
}

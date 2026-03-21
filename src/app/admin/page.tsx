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

export default function AdminPage() {
  const router = useRouter()
  const { t } = useI18n()

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <section className={`space-y-5 ${manrope.className}`}>
          <div className="page-title">{t("Panel de Superusuario", "Superuser panel")}</div>

          <div className="welcome-banner" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)" }}>
            <h2>{t("Control Total del Sistema", "Full system control")}</h2>
            <p>{t("Administración y configuración", "Administration and configuration")}</p>
          </div>

          <div className="quick-actions">
            <button className="quick-action-btn" onClick={() => router.push("/shifts")}>
              <svg className="quick-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 11c0 2.2-1.8 4-4 4s-4-1.8-4-4" />
                <circle cx="12" cy="11" r="8" />
                <path d="M12 15v6" />
              </svg>
              <span>{t("Funciones Supervisor", "Supervisor tools")}</span>
            </button>
            <button className="quick-action-btn" onClick={() => router.push("/users")}>
              <svg className="quick-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 11c0 2.2-1.8 4-4 4s-4-1.8-4-4" />
                <path d="M21 20c-1.5-3-4.5-4-9-4s-7.5 1-9 4" />
                <path d="M19 8l2 2-2 2" />
              </svg>
              <span>{t("Gestionar Supervisores", "Manage supervisors")}</span>
            </button>
            <button className="quick-action-btn" onClick={() => router.push("/account/password")}>
              <svg className="quick-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c0 .7.4 1.3 1.1 1.5H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
              <span>{t("Configuración", "Configuration")}</span>
            </button>
            <button className="quick-action-btn" onClick={() => router.push("/reports")}>
              <svg className="quick-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="M7 16V9" />
                <path d="M12 16V5" />
                <path d="M17 16v-7" />
              </svg>
              <span>{t("Auditoría", "Audit logs")}</span>
            </button>
          </div>
        </section>
      </RoleGuard>
    </ProtectedRoute>
  )
}

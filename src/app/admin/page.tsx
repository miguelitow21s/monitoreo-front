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
            <button className="quick-action-btn" onClick={() => router.push("/restaurants")}>
              <svg className="quick-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-6 9 6v11a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z" />
              </svg>
              <span>{t("Restaurantes", "Restaurants")}</span>
            </button>
            <button className="quick-action-btn" onClick={() => router.push("/users")}>
              <svg className="quick-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>{t("Empleados", "Employees")}</span>
            </button>
            <button className="quick-action-btn" onClick={() => router.push("/shifts")}>
              <svg className="quick-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4" />
                <path d="M8 2v4" />
                <path d="M3 10h18" />
              </svg>
              <span>{t("Turnos", "Shifts")}</span>
            </button>
            <button className="quick-action-btn" onClick={() => router.push("/reports")}>
              <svg className="quick-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="M7 16V9" />
                <path d="M12 16V5" />
                <path d="M17 16v-7" />
              </svg>
              <span>{t("Informes", "Reports")}</span>
            </button>
          </div>
        </section>
      </RoleGuard>
    </ProtectedRoute>
  )
}

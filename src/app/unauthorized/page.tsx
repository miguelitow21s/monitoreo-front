"use client"

import Link from "next/link"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"

export default function UnauthorizedPage() {
  const { t } = useI18n()
  const { logout } = useAuth()

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="logo">
          <div className="logo-icon">WT</div>
          <h1>{t("Acceso no autorizado", "Unauthorized access")}</h1>
          <p>{t("Tu rol actual no tiene acceso a esta sección.", "Your current role does not have access to this section.")}</p>
        </div>

        <div className="flex flex-col gap-3">
          <Link href="/dashboard" className="btn btn-primary">
            {t("Volver al panel", "Back to dashboard")}
          </Link>
          <button onClick={logout} className="btn btn-secondary">
            {t("Cerrar sesión", "Sign out")}
          </button>
        </div>
      </div>
    </div>
  )
}

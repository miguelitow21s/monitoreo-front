"use client"

import { useRouter } from "next/navigation"
import { Manrope } from "next/font/google"

import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import Button from "@/components/ui/Button"
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
        <section className={`flex min-h-[70vh] items-start justify-center px-3 ${manrope.className}`}>
          <div className="w-full max-w-md space-y-4">
            <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
              <div className="bg-gradient-to-br from-indigo-600 to-blue-700 px-6 py-6 text-white">
                <p className="text-2xl font-bold">{t("Panel de super admin", "Super admin panel")}</p>
                <p className="mt-2 text-sm text-indigo-100">
                  {t("Accesos directos principales.", "Main quick access.")}
                </p>
              </div>

              <div className="space-y-3 px-6 py-6">
                <Button fullWidth className="h-16 rounded-2xl text-base" variant="secondary" onClick={() => router.push("/restaurants")}>
                  {t("Restaurantes", "Restaurants")}
                </Button>
                <Button fullWidth className="h-16 rounded-2xl text-base" variant="secondary" onClick={() => router.push("/users")}>
                  {t("Usuarios", "Users")}
                </Button>
                <Button fullWidth className="h-16 rounded-2xl text-base" variant="secondary" onClick={() => router.push("/shifts")}>
                  {t("Turnos", "Shifts")}
                </Button>
                <Button fullWidth className="h-16 rounded-2xl text-base" variant="secondary" onClick={() => router.push("/reports")}>
                  {t("Reportes", "Reports")}
                </Button>
              </div>
            </div>
          </div>
        </section>
      </RoleGuard>
    </ProtectedRoute>
  )
}

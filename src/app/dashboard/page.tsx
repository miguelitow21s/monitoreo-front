"use client"

import { useRouter } from "next/navigation"
import { Manrope } from "next/font/google"

import ProtectedRoute from "@/components/ProtectedRoute"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"
import Button from "@/components/ui/Button"

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
})

export default function DashboardPage() {
  const router = useRouter()
  const { t } = useI18n()
  const { loading: authLoading, user, logout } = useAuth()
  const { loading, isEmpleado, isSupervisora, isSuperAdmin } = useRole()

  if (loading || authLoading) {
    return (
      <ProtectedRoute>
        <section className="flex min-h-[50vh] items-center justify-center px-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            {t("Cargando...", "Loading...")}
          </div>
        </section>
      </ProtectedRoute>
    )
  }

  const displayName = (() => {
    const metadata = user?.user_metadata as { full_name?: string; name?: string } | undefined
    return metadata?.full_name ?? metadata?.name ?? user?.email?.split("@")[0] ?? t("usuario", "user")
  })()

  if (!isSuperAdmin) {
    if (isEmpleado) {
      return (
        <ProtectedRoute>
          <section className={`flex min-h-[70vh] items-start justify-center px-3 ${manrope.className}`}>
            <div className="w-full max-w-sm space-y-4">
                <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                <div className="bg-gradient-to-br from-blue-600 to-blue-700 px-6 py-6 text-white">
                  <p className="text-2xl font-bold">👋 {t("Hola", "Hi")}, {displayName}</p>
                  <div className="mt-2 flex items-center gap-2 text-sm text-blue-100">
                    <span className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" />
                    <span>{t("En linea • Listo para trabajar", "Online • Ready to work")}</span>
                  </div>
                </div>

                <div className="space-y-4 px-6 py-6">
                  <Button
                    fullWidth
                    className="h-44 rounded-[28px] border-emerald-600 bg-gradient-to-br from-emerald-500 to-emerald-600 text-xl font-extrabold text-white shadow-lg hover:from-emerald-500 hover:to-emerald-600"
                    onClick={() => router.push("/shifts?view=start")}
                  >
                    <span className="text-4xl">▶️</span>
                    <span className="leading-tight text-center">
                      {t("INICIAR", "START")}
                      <br />
                      {t("TURNO", "SHIFT")}
                    </span>
                  </Button>

                  <Button
                    fullWidth
                    variant="secondary"
                    className="h-16 rounded-2xl text-base"
                    onClick={() => router.push("/shifts?view=profile")}
                  >
                    <span className="text-2xl">👤</span>
                    {t("Ver perfil", "View profile")}
                  </Button>

                  <Button
                    fullWidth
                    variant="ghost"
                    className="h-12 rounded-2xl border border-rose-200 text-rose-600 hover:bg-rose-50"
                    onClick={logout}
                  >
                    <span>🚪</span>
                    {t("Cerrar sesión", "Sign out")}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </ProtectedRoute>
      )
    }

    return (
      <ProtectedRoute>
        <section className={`flex min-h-[70vh] items-start justify-center px-3 ${manrope.className}`}>
          <div className="w-full max-w-sm space-y-4">
            <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
              <div className="bg-gradient-to-br from-sky-600 to-blue-700 px-6 py-6 text-white">
                <p className="text-2xl font-bold">👋 {t("Hola", "Hi")}, {displayName}</p>
                <div className="mt-2 flex items-center gap-2 text-sm text-blue-100">
                  <span className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" />
                  <span>{t("Supervision lista", "Supervision ready")}</span>
                </div>
              </div>

              <div className="space-y-4 px-6 py-6">
                <Button
                  fullWidth
                  className="h-16 rounded-[24px] border-blue-600 bg-gradient-to-br from-blue-500 to-blue-600 text-lg font-extrabold text-white shadow-lg hover:from-blue-500 hover:to-blue-600"
                  onClick={() => router.push("/shifts")}
                >
                  {t("VER TURNOS", "VIEW SHIFTS")}
                </Button>

                <Button
                  fullWidth
                  variant="secondary"
                  className="h-14 rounded-2xl text-base"
                  onClick={() => router.push("/reports")}
                >
                  {t("Ver reportes", "View reports")}
                </Button>

                <Button
                  fullWidth
                  variant="ghost"
                  className="h-12 rounded-2xl border border-rose-200 text-rose-600 hover:bg-rose-50"
                  onClick={logout}
                >
                  <span>🚪</span>
                  {t("Cerrar sesión", "Sign out")}
                </Button>
              </div>
            </div>
          </div>
        </section>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <section className={`flex min-h-[70vh] items-start justify-center px-3 ${manrope.className}`}>
        <div className="w-full max-w-md space-y-4">
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="bg-gradient-to-br from-indigo-600 to-blue-700 px-6 py-6 text-white">
              <p className="text-2xl font-bold">👋 {t("Hola", "Hi")}, {displayName}</p>
            </div>

            <div className="space-y-3 px-6 py-6">
              <Button fullWidth className="h-16 rounded-2xl text-base" variant="secondary" onClick={() => router.push("/restaurants")}>
                {t("Restaurantes", "Restaurants")}
              </Button>
              <Button fullWidth className="h-16 rounded-2xl text-base" variant="secondary" onClick={() => router.push("/users")}>
                {t("Usuarios", "Users")}
              </Button>
              <Button fullWidth className="h-16 rounded-2xl text-base" variant="secondary" onClick={() => router.push("/reports")}>
                {t("Reportes", "Reports")}
              </Button>
              <Button fullWidth className="h-16 rounded-2xl text-base" variant="secondary" onClick={() => router.push("/shifts")}>
                {t("Turnos", "Shifts")}
              </Button>
              <Button
                fullWidth
                className="h-16 rounded-2xl border border-rose-200 text-rose-600 hover:bg-rose-50"
                variant="ghost"
                onClick={logout}
              >
                <span>🚪</span>
                {t("Cerrar sesión", "Sign out")}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </ProtectedRoute>
  )
}

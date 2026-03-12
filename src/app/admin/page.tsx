"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import Skeleton from "@/components/ui/Skeleton"
import { useToast } from "@/components/toast/ToastProvider"
import { useI18n } from "@/hooks/useI18n"
import { DashboardMetric, fetchDashboardMetrics } from "@/services/dashboard.service"
import { ROLES } from "@/utils/permissions"

export default function AdminPage() {
  const router = useRouter()
  const { t } = useI18n()
  const { showToast } = useToast()
  const [metrics, setMetrics] = useState<DashboardMetric[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await fetchDashboardMetrics()
      setMetrics(rows)
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudieron cargar metricas.", "Could not load metrics."))
    } finally {
      setLoading(false)
    }
  }, [showToast, t])

  useEffect(() => {
    void load()
  }, [load])

  const actions = useMemo(
    () => [
      { label: t("Gestion de usuarios", "User management"), onClick: () => router.push("/users") },
      { label: t("Gestion de restaurantes", "Restaurant management"), onClick: () => router.push("/restaurants") },
      { label: t("Asignacion de supervisoras", "Supervisor assignment"), onClick: () => router.push("/restaurants") },
      { label: t("Operaciones de turnos", "Shift operations"), onClick: () => router.push("/shifts") },
    ],
    [router, t]
  )

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <section className="space-y-4">
          <Card
            title={t("Centro de administracion", "Administration center")}
            subtitle={t("Vista ejecutiva para super_admin.", "Executive view for super_admin.")}
          />

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-28" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map(metric => (
                <Card key={metric.label} title={metric.label} value={metric.value} trend={metric.trend} variant="stat" />
              ))}
            </div>
          )}

          <Card
            title={t("Acciones administrativas", "Administrative actions")}
            subtitle={t("Atajos para funciones criticas de super_admin.", "Shortcuts for critical super_admin flows.")}
          >
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {actions.map(action => (
                <Button key={action.label} variant="secondary" onClick={action.onClick}>
                  {action.label}
                </Button>
              ))}
            </div>
          </Card>
        </section>
      </RoleGuard>
    </ProtectedRoute>
  )
}

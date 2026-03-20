"use client"

import { useMemo, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Manrope } from "next/font/google"

import ProtectedRoute from "@/components/ProtectedRoute"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"
import { EmployeeDashboardData, getEmployeeSelfDashboard } from "@/services/employeeSelfService.service"

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
})

export default function DashboardPage() {
  const router = useRouter()
  const { t, formatDate, formatTime } = useI18n()
  const { loading: authLoading, user } = useAuth()
  const { loading, isEmpleado, isSupervisora, isSuperAdmin } = useRole()
  const [employeeDashboard, setEmployeeDashboard] = useState<EmployeeDashboardData | null>(null)
  const [employeeLoading, setEmployeeLoading] = useState(false)

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

  useEffect(() => {
    if (!isEmpleado || authLoading || loading) return
    let mounted = true
    setEmployeeLoading(true)
    getEmployeeSelfDashboard()
      .then(data => {
        if (mounted) setEmployeeDashboard(data)
      })
      .catch(() => {
        if (mounted) setEmployeeDashboard(null)
      })
      .finally(() => {
        if (mounted) setEmployeeLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [authLoading, isEmpleado, loading])

  const nextShift = useMemo(() => {
    const shifts = employeeDashboard?.scheduled_shifts ?? []
    if (shifts.length === 0) return null
    const now = Date.now()
    const sorted = [...shifts].sort(
      (a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()
    )
    return (
      sorted.find(shift => {
        const end = new Date(shift.scheduled_end).getTime()
        return Number.isFinite(end) && end >= now
      }) ?? sorted[0]
    )
  }, [employeeDashboard])

  const restaurantLabel = useMemo(() => {
    const restaurants = employeeDashboard?.assigned_restaurants ?? []
    const map = new Map(restaurants.map(item => [item.id, item.name ?? `#${item.id}`]))
    if (nextShift?.restaurant_id) {
      return map.get(nextShift.restaurant_id) ?? `#${nextShift.restaurant_id}`
    }
    return restaurants[0]?.name ?? t("Sin restaurante", "No restaurant")
  }, [employeeDashboard, nextShift, t])

  const shiftHours = useMemo(() => {
    if (!nextShift) return t("Sin turno programado", "No scheduled shift")
    const start = formatTime(nextShift.scheduled_start, { hour: "2-digit", minute: "2-digit" })
    const end = formatTime(nextShift.scheduled_end, { hour: "2-digit", minute: "2-digit" })
    return `${start} - ${end}`
  }, [formatTime, nextShift, t])

  const shiftDate = useMemo(() => {
    if (!nextShift) return t("Sin fecha", "No date")
    return formatDate(nextShift.scheduled_start, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }, [formatDate, nextShift, t])

  const pendingSpecialTasks = useMemo(
    () => employeeDashboard?.pending_tasks_preview ?? [],
    [employeeDashboard]
  )
  const showSpecialTasksCard = employeeLoading || pendingSpecialTasks.length > 0

  const adminQuickActions = useMemo(
    () => [
      {
        key: "restaurants",
        label: t("Restaurantes", "Restaurants"),
        helper: t("Gestion", "Manage"),
        icon: "🏬",
        href: "/restaurants",
      },
      {
        key: "users",
        label: t("Usuarios", "Users"),
        helper: t("Gestion", "Manage"),
        icon: "👥",
        href: "/users",
      },
      {
        key: "shifts",
        label: t("Turnos", "Shifts"),
        helper: t("Monitoreo", "Monitoring"),
        icon: "🗓️",
        href: "/shifts",
      },
      {
        key: "reports",
        label: t("Informes", "Reports"),
        helper: t("Historial", "History"),
        icon: "📊",
        href: "/reports",
      },
    ],
    [t]
  )

  if (!isSuperAdmin) {
    if (isEmpleado) {
      return (
        <ProtectedRoute>
          <section className={`space-y-5 ${manrope.className}`}>
            <div className="welcome-banner">
              <h2>{t("¡Hola", "Hello")}, {displayName}!</h2>
              <p>{shiftDate}</p>
            </div>

            <div className="shift-info">
              <div className="info-item">
                <div className="info-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <path d="M3 9l9-6 9 6v11a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z" />
                  </svg>
                </div>
                <div>
                  <label>{t("Restaurante", "Restaurant")}</label>
                  <span className="info-value">{restaurantLabel}</span>
                </div>
              </div>
              <div className="info-item">
                <div className="info-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 3" />
                  </svg>
                </div>
                <div>
                  <label>{t("Horario", "Schedule")}</label>
                  <span className="info-value">{shiftHours}</span>
                </div>
              </div>
              <div className="info-item">
                <div className="info-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <path d="M12 22s7-7.5 7-12a7 7 0 0 0-14 0c0 4.5 7 12 7 12z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </div>
                <div>
                  <label>{t("Ubicación", "Location")}</label>
                  <span className="info-value">
                    {nextShift ? t("Restaurante asignado", "Assigned restaurant") : t("Sin turno", "No shift")}
                  </span>
                </div>
              </div>
            </div>

            {showSpecialTasksCard && (
              <div className="task-card">
                <h4>{t("Tarea especial asignada", "Special task assigned")}</h4>
                {employeeLoading ? (
                  <p>{t("Cargando...", "Loading...")}</p>
                ) : (
                  <div className="task-observations">
                    {pendingSpecialTasks.length > 0 ? (
                      <ul className="space-y-2">
                        {pendingSpecialTasks.map(task => (
                          <li key={task.id}>{task.title ?? t("Tarea asignada", "Assigned task")}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>{t("Sin tareas especiales pendientes.", "No special tasks pending.")}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="action-buttons">
              <button className="btn-large btn-success" type="button" onClick={() => router.push("/shifts?view=start")}>
                {t("Iniciar Turno", "Start shift")}
              </button>
            </div>
          </section>
        </ProtectedRoute>
      )
    }

    return (
      <ProtectedRoute>
        <section className={`space-y-5 ${manrope.className}`}>
          <div className="page-title">{t("Panel de Control", "Dashboard")}</div>

          <div className="welcome-banner">
            <h2>{t("¡Bienvenido, Supervisor!", "Welcome, Supervisor!")}</h2>
            <p>{t("Gestión de equipos de limpieza", "Cleaning team management")}</p>
          </div>

          <div className="quick-actions">
            {adminQuickActions.map(action => (
              <button
                key={action.key}
                type="button"
                onClick={() => router.push(action.href)}
                className="quick-action-btn"
              >
                <span className="quick-action-icon">{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">{t("Alertas Recientes", "Recent alerts")}</div>
            </div>
            <div className="alert alert-warning">
              <div>
                <strong>{t("Turno no iniciado", "Shift not started")}</strong>
                <div className="text-xs">
                  {t(
                    "María G. no ha iniciado turno en Restaurant Don Juan (programado 08:00)",
                    "Maria G. has not started her shift at Restaurant Don Juan (scheduled 08:00)"
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <section className={`space-y-5 ${manrope.className}`}>
        <div className="page-title">{t("Panel de Superusuario", "Superuser panel")}</div>

        <div className="welcome-banner" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)" }}>
          <h2>{t("Control Total del Sistema", "Full system control")}</h2>
          <p>{t("Administración y configuración", "Administration and configuration")}</p>
        </div>

        <div className="quick-actions">
          {adminQuickActions.map(action => (
            <button
              key={action.key}
              type="button"
              onClick={() => router.push(action.href)}
              className="quick-action-btn"
            >
              <span className="quick-action-icon">{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">{t("Supervisiones realizadas hoy", "Supervisions completed today")}</div>
          </div>
          <div className="employee-list-item">
            <div className="employee-avatar">JP</div>
            <div className="employee-info">
              <h4>{t("Juan Pérez (Supervisor)", "Juan Perez (Supervisor)")}</h4>
              <p>{t("Restaurant Don Juan - 10:30 AM", "Restaurant Don Juan - 10:30 AM")}</p>
            </div>
            <small className="text-emerald-300">{t("Verificado en sitio", "Verified on site")}</small>
          </div>
        </div>
      </section>
    </ProtectedRoute>
  )
}

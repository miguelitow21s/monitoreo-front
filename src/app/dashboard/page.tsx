"use client"

import { useMemo, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Manrope } from "next/font/google"

import ProtectedRoute from "@/components/ProtectedRoute"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"
import { EmployeeDashboardData, getEmployeeSelfDashboard } from "@/services/employeeSelfService.service"
import { listSupervisorPresenceToday, SupervisorPresenceSummary } from "@/services/supervisorPresence.service"

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
})

export default function DashboardPage() {
  const router = useRouter()
  const { t, formatDate, formatTime } = useI18n()
  const { loading: authLoading, user } = useAuth()
  const { loading, isEmpleado, isSuperAdmin } = useRole()
  const [employeeDashboard, setEmployeeDashboard] = useState<EmployeeDashboardData | null | undefined>(undefined)
  const [todaySupervisions, setTodaySupervisions] = useState<SupervisorPresenceSummary[]>([])
  const [loadingTodaySupervisions, setLoadingTodaySupervisions] = useState(false)

  const displayName = (() => {
    const metadata = user?.user_metadata as { full_name?: string; name?: string } | undefined
    return metadata?.full_name ?? metadata?.name ?? user?.email?.split("@")[0] ?? t("usuario", "user")
  })()

  useEffect(() => {
    if (!isEmpleado || authLoading || loading) return
    let mounted = true
    getEmployeeSelfDashboard()
      .then(data => {
        if (mounted) setEmployeeDashboard(data)
      })
      .catch(() => {
        if (mounted) setEmployeeDashboard(null)
      })
    return () => {
      mounted = false
    }
  }, [authLoading, isEmpleado, loading])

  useEffect(() => {
    if (!isSuperAdmin || authLoading || loading) return
    let mounted = true
    setLoadingTodaySupervisions(true)
    const range = buildDayRangeForTimeZone(resolveDashboardTimeZone())
    listSupervisorPresenceToday(20, range)
      .then(items => {
        if (mounted) setTodaySupervisions(items)
      })
      .catch(() => {
        if (mounted) setTodaySupervisions([])
      })
      .finally(() => {
        if (mounted) setLoadingTodaySupervisions(false)
      })

    return () => {
      mounted = false
    }
  }, [authLoading, isSuperAdmin, loading])

  const nextShift = useMemo(() => {
    const shifts = employeeDashboard?.scheduled_shifts ?? []
    if (shifts.length === 0) return null
    const sorted = [...shifts].sort(
      (a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()
    )
    return sorted[0] ?? null
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
  const employeeLoading = isEmpleado && employeeDashboard === undefined
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

  const resolveDashboardTimeZone = () => {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
    return resolved && resolved.trim().length > 0 ? resolved : "America/New_York"
  }

  const getTimeZoneParts = (date: Date, timeZone: string) => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    const parts = formatter.formatToParts(date)
    const map = parts.reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value
      return acc
    }, {} as Record<string, string>)
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour),
      minute: Number(map.minute),
      second: Number(map.second),
    }
  }

  const getTimeZoneOffsetMinutes = (date: Date, timeZone: string) => {
    const parts = getTimeZoneParts(date, timeZone)
    const utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    return (utc - date.getTime()) / 60000
  }

  const formatOffset = (offsetMinutes: number) => {
    const sign = offsetMinutes >= 0 ? "+" : "-"
    const abs = Math.abs(offsetMinutes)
    const hours = String(Math.floor(abs / 60)).padStart(2, "0")
    const minutes = String(Math.floor(abs % 60)).padStart(2, "0")
    return `${sign}${hours}:${minutes}`
  }

  const buildDayRangeForTimeZone = (timeZone: string) => {
    const now = new Date()
    const todayParts = getTimeZoneParts(now, timeZone)
    const baseUtc = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day, 0, 0, 0)
    let offset = getTimeZoneOffsetMinutes(new Date(baseUtc), timeZone)
    let utcMidnight = baseUtc - offset * 60000
    const recalculatedOffset = getTimeZoneOffsetMinutes(new Date(utcMidnight), timeZone)
    if (recalculatedOffset !== offset) {
      offset = recalculatedOffset
      utcMidnight = baseUtc - offset * 60000
    }

    const offsetLabel = formatOffset(offset)
    const from = `${todayParts.year}-${String(todayParts.month).padStart(2, "0")}-${String(todayParts.day).padStart(2, "0")}T00:00:00${offsetLabel}`

    const tomorrow = new Date(utcMidnight + 24 * 60 * 60 * 1000)
    const tomorrowParts = getTimeZoneParts(tomorrow, timeZone)
    const tomorrowBaseUtc = Date.UTC(tomorrowParts.year, tomorrowParts.month - 1, tomorrowParts.day, 0, 0, 0)
    let tomorrowOffset = getTimeZoneOffsetMinutes(new Date(tomorrowBaseUtc), timeZone)
    let tomorrowUtcMidnight = tomorrowBaseUtc - tomorrowOffset * 60000
    const recalculatedTomorrowOffset = getTimeZoneOffsetMinutes(new Date(tomorrowUtcMidnight), timeZone)
    if (recalculatedTomorrowOffset !== tomorrowOffset) {
      tomorrowOffset = recalculatedTomorrowOffset
      tomorrowUtcMidnight = tomorrowBaseUtc - tomorrowOffset * 60000
    }
    const tomorrowOffsetLabel = formatOffset(tomorrowOffset)
    const to = `${tomorrowParts.year}-${String(tomorrowParts.month).padStart(2, "0")}-${String(tomorrowParts.day).padStart(2, "0")}T00:00:00${tomorrowOffsetLabel}`

    return { from, to }
  }

  const supervisionStatusLabel = (phase: SupervisorPresenceSummary["phase"]) => {
    if (phase === "end") return t("Verificado en sitio", "Verified on site")
    return t("Inicio verificado", "Start verified")
  }

  const supervisionLine = (item: SupervisorPresenceSummary) => {
    const restaurant = item.restaurant_name ?? (item.restaurant_id ? `#${item.restaurant_id}` : t("Sin restaurante", "No restaurant"))
    const time = formatTime(item.recorded_at, { hour: "2-digit", minute: "2-digit" })
    return `${restaurant} - ${time}`
  }

  const supervisorDisplayName = (item: SupervisorPresenceSummary) => {
    if (item.supervisor_name) return item.supervisor_name
    if (item.supervisor_id) return `Supervisor ${item.supervisor_id.slice(0, 8)}`
    return t("Supervisor", "Supervisor")
  }

  const supervisorInitials = (name: string) => {
    const chunks = name.split(" ").filter(Boolean)
    if (chunks.length === 0) return "SV"
    if (chunks.length === 1) return chunks[0].slice(0, 2).toUpperCase()
    return `${chunks[0][0]}${chunks[1][0]}`.toUpperCase()
  }

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
          {loadingTodaySupervisions ? (
            <div className="text-sm text-slate-500">{t("Cargando...", "Loading...")}</div>
          ) : todaySupervisions.length === 0 ? (
            <div className="text-sm text-slate-500">{t("Sin supervisiones registradas hoy.", "No supervision records today.")}</div>
          ) : (
            <div className="space-y-2">
              {todaySupervisions.slice(0, 6).map(item => {
                const name = supervisorDisplayName(item)
                return (
                  <div key={item.id} className="employee-list-item">
                    <div className="employee-avatar">{supervisorInitials(name)}</div>
                    <div className="employee-info">
                      <h4>{name}</h4>
                      <p>{supervisionLine(item)}</p>
                    </div>
                    <small className="text-emerald-300">{supervisionStatusLabel(item.phase)}</small>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </ProtectedRoute>
  )
}

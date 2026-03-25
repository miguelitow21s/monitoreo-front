"use client"

import { useCallback, useMemo, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Manrope } from "next/font/google"

import ProtectedRoute from "@/components/ProtectedRoute"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"
import tzLookup from "tz-lookup"

import { EmployeeDashboardData, getEmployeeSelfDashboard } from "@/services/employeeSelfService.service"
import { listRestaurants, Restaurant } from "@/services/restaurants.service"
import { listUserProfiles } from "@/services/users.service"
import { listScheduledShiftsAll } from "@/services/scheduling.service"
import { getActiveShiftsForSupervision } from "@/services/operations.service"

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
})

const PRESENCE_FETCH_CONCURRENCY = 4

type ActionIconKey = "restaurants" | "users" | "shifts" | "reports" | "config" | "audit"

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

  const from = new Date(utcMidnight).toISOString()

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
  const to = new Date(tomorrowUtcMidnight).toISOString()

  return { from, to }
}

const resolveRestaurantTimeZone = (restaurant: Restaurant, fallback: string) => {
  if (typeof restaurant.lat === "number" && typeof restaurant.lng === "number") {
    try {
      return tzLookup(restaurant.lat, restaurant.lng)
    } catch {
      return fallback
    }
  }
  return fallback
}

function ActionIcon({ name }: { name: ActionIconKey }) {
  if (name === "restaurants") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 10h16v10H4z" />
        <path d="M7 10V7h10v3" />
        <path d="M9 14h6" />
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

  if (name === "config") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c0 .7.4 1.3 1.1 1.5H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    )
  }

  if (name === "audit") {
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

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h16" />
      <path d="M7 16v-5" />
      <path d="M12 16v-9" />
      <path d="M17 16v-3" />
    </svg>
  )
}

function AlertOkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.2 2.2 4.8-4.8" />
    </svg>
  )
}

function AlertWarnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <path d="M12 4 3 20h18L12 4z" />
      <path d="M12 9v5" />
      <path d="M12 17h.01" />
    </svg>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const { t, formatDate, formatTime } = useI18n()
  const { loading: authLoading, user } = useAuth()
  const { loading, isEmpleado, isSuperAdmin } = useRole()
  const [employeeDashboard, setEmployeeDashboard] = useState<EmployeeDashboardData | null | undefined>(undefined)
  const [supervisorAlertItems, setSupervisorAlertItems] = useState<string[]>([])
  const [supervisorAlertIndex, setSupervisorAlertIndex] = useState(0)
  const [loadingSupervisorAlerts, setLoadingSupervisorAlerts] = useState(false)
  const isSupervisor = !isEmpleado && !isSuperAdmin

  const displayName = (() => {
    const metadata = user?.user_metadata as { full_name?: string; name?: string } | undefined
    return metadata?.full_name ?? metadata?.name ?? user?.email?.split("@")[0] ?? t("usuario", "user")
  })()

  const refreshEmployeeDashboard = useCallback(async () => {
    if (!isEmpleado || authLoading || loading) return
    const data = await getEmployeeSelfDashboard()
    setEmployeeDashboard(data)
  }, [authLoading, isEmpleado, loading])

  useEffect(() => {
    if (!isEmpleado || authLoading || loading) return
    let mounted = true

    const load = async () => {
      try {
        const data = await getEmployeeSelfDashboard()
        if (mounted) setEmployeeDashboard(data)
      } catch {
        if (mounted) setEmployeeDashboard(null)
      }
    }

    void load()

    const intervalId = window.setInterval(() => {
      void refreshEmployeeDashboard()
    }, 60000)

    const handleFocus = () => {
      void refreshEmployeeDashboard()
    }
    window.addEventListener("focus", handleFocus)

    return () => {
      mounted = false
      window.clearInterval(intervalId)
      window.removeEventListener("focus", handleFocus)
    }
  }, [authLoading, isEmpleado, loading, refreshEmployeeDashboard])

  const loadSupervisorAlerts = useCallback(async () => {
    if (!isSupervisor || authLoading || loading) return
    setLoadingSupervisorAlerts(true)
    try {
      const [active, restaurants, profiles] = await Promise.all([
        getActiveShiftsForSupervision(80),
        listRestaurants({ includeInactive: false }),
        listUserProfiles(),
      ])

      const restaurantById = restaurants.reduce((acc, restaurant) => {
        const numericId = Number(restaurant.id)
        if (Number.isFinite(numericId)) {
          acc.set(numericId, restaurant)
        }
        return acc
      }, new Map<number, Restaurant>())

      const supervisorNameById = profiles.reduce((acc, profile) => {
        acc.set(profile.id, profile.full_name ?? profile.email ?? profile.id)
        return acc
      }, new Map<string, string>())

      const activeKeys = new Set(
        active
          .map(row => {
            const employee = row.employee_id ?? ""
            if (!employee) return null
            const restaurant =
              row.restaurant_id !== null && row.restaurant_id !== undefined ? String(row.restaurant_id) : ""
            return `${employee}|${restaurant}`
          })
          .filter((key): key is string => !!key)
      )

      const fallbackTimezone = resolveDashboardTimeZone()
      const scheduled: Awaited<ReturnType<typeof listScheduledShiftsAll>> = []
      const restaurantQueue = restaurants.filter(item => Number.isFinite(Number(item.id)))

      if (restaurantQueue.length === 0) {
        const range = buildDayRangeForTimeZone(fallbackTimezone)
        const rows = await listScheduledShiftsAll(200, null, { ...range, status: "scheduled" })
        scheduled.push(...rows)
      } else {
        const workers = Array.from(
          { length: Math.min(PRESENCE_FETCH_CONCURRENCY, restaurantQueue.length) },
          () =>
            (async () => {
              while (restaurantQueue.length > 0) {
                const restaurant = restaurantQueue.shift()
                if (!restaurant) return
                const restaurantId = Number(restaurant.id)
                if (!Number.isFinite(restaurantId)) continue
                const timeZone = resolveRestaurantTimeZone(restaurant, fallbackTimezone)
                const range = buildDayRangeForTimeZone(timeZone)
                const rows = await listScheduledShiftsAll(200, restaurantId, { ...range, status: "scheduled" })
                scheduled.push(...rows)
              }
            })()
        )
        await Promise.all(workers)
      }

      const items: string[] = []
      for (const shift of scheduled) {
        const status = (shift.status ?? "").toLowerCase()
        if (status === "cancelled" || status === "canceled") continue
        if (status === "completed" || status === "finished" || status === "finalizado") continue
        if (status === "in_progress" || status === "active" || status === "activo") continue

        const startMs = new Date(shift.scheduled_start).getTime()
        if (!Number.isFinite(startMs)) continue
        if (Date.now() < startMs) continue

        const restaurantLabel =
          restaurantById.get(Number(shift.restaurant_id))?.name ??
          `#${shift.restaurant_id}`
        const employeeLabel = supervisorNameById.get(shift.employee_id) ?? shift.employee_id.slice(0, 8)
        const timeLabel = formatTime(shift.scheduled_start, { hour: "2-digit", minute: "2-digit" })

        const key = `${shift.employee_id}|${Number.isFinite(shift.restaurant_id) ? shift.restaurant_id : ""}`
        if (activeKeys.has(key)) continue

        items.push(
          `${t("Turno no iniciado", "Shift not started")}: ${employeeLabel} ${t(
            "no ha iniciado turno en",
            "has not started shift at"
          )} ${restaurantLabel} (${t("programado", "scheduled")} ${timeLabel})`
        )
      }

      setSupervisorAlertItems(items)
    } catch {
      setSupervisorAlertItems([])
    } finally {
      setLoadingSupervisorAlerts(false)
    }
  }, [authLoading, formatTime, isSupervisor, loading, t])

  useEffect(() => {
    if (!isSupervisor || authLoading || loading) return
    let mounted = true
    const load = async () => {
      if (!mounted) return
      await loadSupervisorAlerts()
    }

    void load()

    const intervalId = window.setInterval(() => {
      void load()
    }, 60000)

    const handleFocus = () => {
      void load()
    }
    window.addEventListener("focus", handleFocus)

    return () => {
      mounted = false
      window.clearInterval(intervalId)
      window.removeEventListener("focus", handleFocus)
    }
  }, [authLoading, isSupervisor, loadSupervisorAlerts, loading])

  useEffect(() => {
    setSupervisorAlertIndex(0)
  }, [supervisorAlertItems.length])

  useEffect(() => {
    if (supervisorAlertItems.length <= 1) return undefined
    const intervalId = window.setInterval(() => {
      setSupervisorAlertIndex(prev => (supervisorAlertItems.length === 0 ? 0 : (prev + 1) % supervisorAlertItems.length))
    }, 6000)
    return () => window.clearInterval(intervalId)
  }, [supervisorAlertItems.length])

  const activeShift = employeeDashboard?.active_shift ?? null

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
    if (activeShift?.restaurant_id) {
      return map.get(activeShift.restaurant_id) ?? `#${activeShift.restaurant_id}`
    }
    if (nextShift?.restaurant_id) {
      return map.get(nextShift.restaurant_id) ?? `#${nextShift.restaurant_id}`
    }
    return restaurants[0]?.name ?? t("Sin restaurante", "No restaurant")
  }, [activeShift?.restaurant_id, employeeDashboard, nextShift, t])

  const shiftDate = useMemo(() => {
    if (activeShift?.start_time || activeShift?.scheduled_start) {
      const startValue = activeShift.start_time ?? activeShift.scheduled_start ?? ""
      if (!startValue) return t("Sin fecha", "No date")
      return formatDate(startValue, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    }
    if (!nextShift) return t("Sin fecha", "No date")
    return formatDate(nextShift.scheduled_start, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }, [activeShift?.scheduled_start, activeShift?.start_time, formatDate, nextShift, t])

  const supervisorQuickActions = useMemo(
    () => [
      {
        key: "restaurants",
        label: t("Restaurantes", "Restaurants"),
        icon: "restaurants" as const,
        href: "/restaurants",
      },
      {
        key: "employees",
        label: t("Empleados", "Employees"),
        icon: "users" as const,
        href: "/users",
      },
      {
        key: "shifts",
        label: t("Turnos", "Shifts"),
        icon: "shifts" as const,
        href: "/shifts?supervisor=turnos",
      },
      {
        key: "reports",
        label: t("Informes", "Reports"),
        icon: "reports" as const,
        href: "/reports",
      },
    ],
    [t]
  )

  const superAdminQuickActions = useMemo(
    () => [
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
    ],
    [t]
  )

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
                    <path d="M4 10h16v10H4z" />
                    <path d="M7 10V7h10v3" />
                    <path d="M9 14h6" />
                  </svg>
                </div>
                <div>
                  <label>{t("Restaurante", "Restaurant")}</label>
                  <span className="info-value">{restaurantLabel}</span>
                </div>
              </div>
            </div>

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
            {supervisorQuickActions.map(action => (
              <button
                key={action.key}
                type="button"
                onClick={() => router.push(action.href)}
                className="quick-action-btn"
              >
                <span className="quick-action-icon">
                  <ActionIcon name={action.icon} />
                </span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">{t("Alertas Recientes", "Recent alerts")}</div>
            </div>
            {loadingSupervisorAlerts ? (
              <div className="text-sm text-slate-500">{t("Cargando...", "Loading...")}</div>
            ) : supervisorAlertItems.length === 0 ? (
              <div className="alert alert-success">
                <span><AlertOkIcon /></span>
                <span>{t("Sin alertas pendientes por ahora.", "No pending alerts right now.")}</span>
              </div>
            ) : (
              <div className="alert alert-warning">
                <span><AlertWarnIcon /></span>
                <div className="text-sm">
                  {supervisorAlertItems[supervisorAlertIndex]}
                  {supervisorAlertItems.length > 1 && (
                    <span className="ml-2 text-xs text-amber-700">
                      {supervisorAlertIndex + 1}/{supervisorAlertItems.length}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <section className={`space-y-5 ${manrope.className}`}>
        <div className="page-title">{t("Panel de Superusuario", "Superuser panel")}</div>

        <div className="quick-actions">
          {superAdminQuickActions.map(action => (
            <button
              key={action.key}
              type="button"
              onClick={() => router.push(action.href)}
              className="quick-action-btn"
            >
              <span className="quick-action-icon">
                <ActionIcon name={action.icon} />
              </span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </section>
    </ProtectedRoute>
  )
}

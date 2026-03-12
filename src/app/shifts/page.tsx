"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import CameraCapture from "@/components/CameraCapture"
import GPSGuard, { Coordinates } from "@/components/GPSGuard"
import Modal from "@/components/Modal"
import ProtectedRoute from "@/components/ProtectedRoute"
import Badge from "@/components/ui/Badge"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"
import { useToast } from "@/components/toast/ToastProvider"
import {
  createShiftIncident,
  getActiveShiftsForSupervision,
  getShiftIncidents,
  resolveEvidenceUrl,
  ShiftIncident,
  SupervisorShiftRow,
  updateShiftStatus,
} from "@/services/operations.service"
import {
  endShift,
  getMyActiveShift,
  getMyShiftHistory,
  sendShiftPhoneOtp,
  ShiftRecord,
  startShift,
  verifyShiftPhoneOtp,
} from "@/services/shifts.service"
import { clearShiftOtpToken, getShiftOtpToken, getOrCreateDeviceFingerprint } from "@/services/securityContext.service"
import { uploadShiftEvidence } from "@/services/evidence.service"
import {
  listMySupervisorPresence,
  registerSupervisorPresence,
  SupervisorPresenceLog,
} from "@/services/supervisorPresence.service"
import {
  cancelScheduledShift,
  listMyScheduledShifts,
  listScheduledShifts,
  reprogramScheduledShift,
  ScheduledShift,
} from "@/services/scheduling.service"
import { supabase } from "@/services/supabaseClient"
import {
  completeOperationalTask,
  createOperationalTask,
  fetchTaskEvidenceManifest,
  listMyOperationalTasks,
  listSupervisorOperationalTasks,
  markTaskInProgress,
  OperationalTask,
  TaskPriority,
  TaskEvidenceManifestResolved,
  requestTaskManifestUpload,
  uploadTaskManifestViaSignedToken,
} from "@/services/tasks.service"
import {
  assignEmployeeToRestaurant,
  listMySupervisorRestaurants,
  listRestaurantEmployees,
  listRestaurants,
  Restaurant,
  RestaurantEmployee,
  SupervisorRestaurantOption,
  unassignEmployeeFromRestaurant,
} from "@/services/restaurants.service"
import { uploadEvidenceObject } from "@/services/storageEvidence.service"
import {
  createEmployeeObservation,
  EmployeeDashboardData,
  getEmployeeSelfDashboard,
} from "@/services/employeeSelfService.service"
import { listUserProfiles, UserProfile } from "@/services/users.service"

const HISTORY_PAGE_SIZE = 8
const MAX_GPS_ACCURACY_METERS = 80
const TASK_SHOT_ORDER: Record<string, number> = {
  close_up: 1,
  mid_range: 2,
  wide_general: 3,
}

type TaskEvidenceShotKey = "close_up" | "mid_range" | "wide_general"

function formatDuration(start: string, end: string | null) {
  const startDate = new Date(start).getTime()
  const endDate = new Date(end ?? Date.now()).getTime()
  if (!Number.isFinite(startDate) || !Number.isFinite(endDate) || endDate < startDate) return "-"

  const minutes = Math.floor((endDate - startDate) / 60000)
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return `${hours}h ${restMinutes}m`
}

function durationMinutes(start: string, end: string | null) {
  if (!end) return 0
  const startDate = new Date(start).getTime()
  const endDate = new Date(end).getTime()
  if (!Number.isFinite(startDate) || !Number.isFinite(endDate) || endDate < startDate) return 0
  return Math.floor((endDate - startDate) / 60000)
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function distanceMeters(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const earthRadiusMeters = 6371000
  const dLat = toRadians(to.lat - from.lat)
  const dLng = toRadians(to.lng - from.lng)
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusMeters * c
}

function extractErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.trim().length > 0) return message
  }
  return fallback
}

function isConsentPendingError(error: unknown) {
  if (typeof error !== "object" || error === null) return false

  const status = (error as { status?: unknown }).status
  if (status === 403) return true

  const message = extractErrorMessage(error, "").toLowerCase()
  return message.includes("consent") || message.includes("legal") || message.includes("data processing")
}

function getCurrentScheduledRestaurantId(scheduledShifts: ScheduledShift[]) {
  const now = Date.now()
  const match = scheduledShifts.find(item => {
    if (item.status !== "scheduled") return false
    const start = new Date(item.scheduled_start).getTime() - 15 * 60 * 1000
    const end = new Date(item.scheduled_end).getTime() + 15 * 60 * 1000
    return now >= start && now <= end
  })
  return match?.restaurant_id
}

async function sha256Hex(blob: Blob) {
  const buffer = await blob.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map(item => item.toString(16).padStart(2, "0"))
    .join("")
}

export default function ShiftsPage() {
  const { isEmpleado, isSupervisora, isSuperAdmin } = useRole()
  const { formatDateTime: formatDateTimeI18n, t } = useI18n()
  const { showToast } = useToast()

  const formatDateTime = useCallback(
    (value: string | null) =>
      formatDateTimeI18n(value, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [formatDateTimeI18n]
  )

  const [coords, setCoords] = useState<Coordinates | null>(null)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [activeShift, setActiveShift] = useState<ShiftRecord | null>(null)
  const [history, setHistory] = useState<ShiftRecord[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [verifyingOtp, setVerifyingOtp] = useState(false)
  const [otpCode, setOtpCode] = useState("")
  const [shiftOtpReady, setShiftOtpReady] = useState(false)
  const [otpVerifiedAt, setOtpVerifiedAt] = useState<string | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotalPages, setHistoryTotalPages] = useState(1)
  const [scheduledShifts, setScheduledShifts] = useState<ScheduledShift[]>([])
  const [supervisionScheduledShifts, setSupervisionScheduledShifts] = useState<ScheduledShift[]>([])
  const [startObservation, setStartObservation] = useState("")
  const [endObservation, setEndObservation] = useState("")
  const [startFitForWork, setStartFitForWork] = useState<boolean | null>(null)
  const [endFitForWork, setEndFitForWork] = useState<boolean | null>(null)
  const [startPpeReady, setStartPpeReady] = useState<boolean | null>(null)
  const [startNoSymptoms, setStartNoSymptoms] = useState<boolean | null>(null)
  const [endIncidentsOccurred, setEndIncidentsOccurred] = useState<boolean | null>(null)
  const [endAreaDelivered, setEndAreaDelivered] = useState<boolean | null>(null)
  const [startHealthDeclaration, setStartHealthDeclaration] = useState("")
  const [endHealthDeclaration, setEndHealthDeclaration] = useState("")
  const [employeeIncident, setEmployeeIncident] = useState("")
  const [creatingEmployeeIncident, setCreatingEmployeeIncident] = useState(false)

  const [supervisorRows, setSupervisorRows] = useState<SupervisorShiftRow[]>([])
  const [loadingSupervisor, setLoadingSupervisor] = useState(false)
  const [incidentNotes, setIncidentNotes] = useState<Record<string, string>>({})
  const [incidentHistory, setIncidentHistory] = useState<Record<string, ShiftIncident[]>>({})
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const [employeeTasks, setEmployeeTasks] = useState<OperationalTask[]>([])
  const [supervisorTasks, setSupervisorTasks] = useState<OperationalTask[]>([])
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [taskCoords, setTaskCoords] = useState<Coordinates | null>(null)
  const [taskPhotoClose, setTaskPhotoClose] = useState<Blob | null>(null)
  const [taskPhotoMid, setTaskPhotoMid] = useState<Blob | null>(null)
  const [taskPhotoWide, setTaskPhotoWide] = useState<Blob | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [processingTask, setProcessingTask] = useState(false)
  const [newTaskByShift, setNewTaskByShift] = useState<Record<string, { title: string; description: string; priority: TaskPriority; dueAt: string }>>({})
  const [creatingTaskForShift, setCreatingTaskForShift] = useState<string | null>(null)

  const [supervisorPresence, setSupervisorPresence] = useState<SupervisorPresenceLog[]>([])
  const [presenceRestaurants, setPresenceRestaurants] = useState<SupervisorRestaurantOption[]>([])
  const [presenceRestaurantId, setPresenceRestaurantId] = useState<number | null>(null)
  const [presenceCoords, setPresenceCoords] = useState<Coordinates | null>(null)
  const [presencePhoto, setPresencePhoto] = useState<Blob | null>(null)
  const [presenceNotes, setPresenceNotes] = useState("")
  const [presencePhase, setPresencePhase] = useState<"start" | "end">("start")
  const [registeringPresence, setRegisteringPresence] = useState(false)
  const [taskDetailModalTask, setTaskDetailModalTask] = useState<OperationalTask | null>(null)
  const [taskDetailManifest, setTaskDetailManifest] = useState<TaskEvidenceManifestResolved | null>(null)
  const [loadingTaskDetailManifest, setLoadingTaskDetailManifest] = useState(false)
  const [taskDetailManifestError, setTaskDetailManifestError] = useState<string | null>(null)
  const [editingSupervisionScheduledId, setEditingSupervisionScheduledId] = useState<number | null>(null)
  const [editSupervisionScheduledStart, setEditSupervisionScheduledStart] = useState("")
  const [editSupervisionScheduledEnd, setEditSupervisionScheduledEnd] = useState("")
  const [knownRestaurants, setKnownRestaurants] = useState<Restaurant[]>([])
  const [employeeDashboard, setEmployeeDashboard] = useState<EmployeeDashboardData | null>(null)
  const [employeeObservationType, setEmployeeObservationType] = useState<"observation" | "alert">("observation")
  const [staffRestaurants, setStaffRestaurants] = useState<SupervisorRestaurantOption[]>([])
  const [staffRestaurantId, setStaffRestaurantId] = useState<number | null>(null)
  const [staffUsers, setStaffUsers] = useState<UserProfile[]>([])
  const [staffUserId, setStaffUserId] = useState("")
  const [staffAssignments, setStaffAssignments] = useState<RestaurantEmployee[]>([])
  const [assigningStaff, setAssigningStaff] = useState(false)
  const [supervisorShiftRestaurantId, setSupervisorShiftRestaurantId] = useState<number | null>(null)
  const [supervisorScheduleEmployeeId, setSupervisorScheduleEmployeeId] = useState("")
  const [supervisorScheduleRestaurantId, setSupervisorScheduleRestaurantId] = useState<number | null>(null)
  const [supervisorScheduleStart, setSupervisorScheduleStart] = useState("")
  const [supervisorScheduleEnd, setSupervisorScheduleEnd] = useState("")
  const [supervisorScheduleNotes, setSupervisorScheduleNotes] = useState("")
  const [supervisorScheduling, setSupervisorScheduling] = useState(false)

  const healthAnswered = activeShift ? endFitForWork !== null : startFitForWork !== null
  const healthDeclarationRequired =
    activeShift ? endFitForWork === false : startFitForWork === false
  const healthDeclarationProvided = activeShift
    ? endHealthDeclaration.trim().length > 0
    : startHealthDeclaration.trim().length > 0

  const startChecklistComplete = startPpeReady !== null && startNoSymptoms !== null
  const endChecklistComplete = endIncidentsOccurred !== null && endAreaDelivered !== null

  const supervisorRestaurantSelected = !isSupervisora || !!supervisorShiftRestaurantId
  const canSubmit =
    !!coords &&
    !!photo &&
    !processing &&
    shiftOtpReady &&
    healthAnswered &&
    supervisorRestaurantSelected &&
    (!healthDeclarationRequired || healthDeclarationProvided) &&
    (activeShift ? endChecklistComplete : startChecklistComplete)

  const canOperateEmployee = isEmpleado
  const canOperateShift = isEmpleado || isSupervisora
  const canOperateSupervisor = isSupervisora || isSuperAdmin

  const activeShiftUploadedEvidenceTypes = useMemo(() => {
    const raw = employeeDashboard?.active_shift?.uploaded_evidence_types ?? employeeDashboard?.uploaded_evidence_types
    if (!Array.isArray(raw)) return [] as string[]
    return raw
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  }, [employeeDashboard])

  const hasStartEvidence = activeShiftUploadedEvidenceTypes.includes("inicio")
  const pendingEmployeeTasks = useMemo(
    () => employeeTasks.filter(task => task.status === "pending" || task.status === "in_progress"),
    [employeeTasks]
  )
  const overdueSupervisorTasks = useMemo(
    () =>
      supervisorTasks.filter(task => {
        if (!task.due_at || task.status === "completed" || task.status === "cancelled") return false
        const dueAt = new Date(task.due_at).getTime()
        return Number.isFinite(dueAt) && dueAt < Date.now()
      }),
    [supervisorTasks]
  )
  const pendingPresenceClosures = useMemo(() => {
    if (supervisorPresence.length === 0) return [] as SupervisorPresenceLog[]
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const rowsToday = supervisorPresence.filter(item => {
      const recordedAt = new Date(item.recorded_at).getTime()
      return Number.isFinite(recordedAt) && recordedAt >= dayStart
    })
    const latestByRestaurant = new Map<number, SupervisorPresenceLog>()
    for (const row of rowsToday) {
      const current = latestByRestaurant.get(row.restaurant_id)
      if (!current || new Date(row.recorded_at).getTime() > new Date(current.recorded_at).getTime()) {
        latestByRestaurant.set(row.restaurant_id, row)
      }
    }
    return Array.from(latestByRestaurant.values()).filter(item => item.phase === "start")
  }, [supervisorPresence])

  const totalWorkedMinutes = useMemo(
    () => history.reduce((acc, item) => acc + durationMinutes(item.start_time, item.end_time), 0),
    [history]
  )

  const nextScheduledShift = useMemo(
    () =>
      [...scheduledShifts]
        .filter(item => item.status === "scheduled")
        .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime())[0] ?? null,
    [scheduledShifts]
  )

  const currentScheduledRestaurant = useMemo(() => {
    const currentRestaurantId = getCurrentScheduledRestaurantId(scheduledShifts)
    if (!currentRestaurantId) return null
    return knownRestaurants.find(item => Number(item.id) === Number(currentRestaurantId)) ?? null
  }, [knownRestaurants, scheduledShifts])

  const supervisorSelectedRestaurant = useMemo(() => {
    if (!supervisorShiftRestaurantId) return null
    return knownRestaurants.find(item => Number(item.id) === Number(supervisorShiftRestaurantId)) ?? null
  }, [knownRestaurants, supervisorShiftRestaurantId])

  const geofenceTarget = isSupervisora ? supervisorSelectedRestaurant : currentScheduledRestaurant

  const geofenceValidation = useMemo(() => {
    if (
      !coords ||
      !geofenceTarget ||
      geofenceTarget.lat === null ||
      geofenceTarget.lng === null ||
      geofenceTarget.geofence_radius_m === null
    ) {
      return null
    }

    const meters = distanceMeters(
      { lat: coords.lat, lng: coords.lng },
      { lat: Number(geofenceTarget.lat), lng: Number(geofenceTarget.lng) }
    )

    const allowedMeters = Number(geofenceTarget.geofence_radius_m)
    return {
      distanceMeters: meters,
      allowedMeters,
      withinGeofence: meters <= allowedMeters,
    }
  }, [coords, geofenceTarget])

  const expectedRestaurantId = useMemo(() => {
    if (isSupervisora && supervisorShiftRestaurantId) return supervisorShiftRestaurantId
    if (currentScheduledRestaurant?.id) return Number(currentScheduledRestaurant.id)
    if (nextScheduledShift?.restaurant_id) return Number(nextScheduledShift.restaurant_id)
    return null
  }, [currentScheduledRestaurant, isSupervisora, nextScheduledShift, supervisorShiftRestaurantId])

  const selectedTask = useMemo(
    () => employeeTasks.find(task => task.id === selectedTaskId) ?? null,
    [employeeTasks, selectedTaskId]
  )

  const submitBlockers = useMemo(() => {
    const blockers: string[] = []
    if (!coords) blockers.push(t("Debes capturar la ubicacion GPS.", "You must capture GPS location."))
    if (coords?.isMocked) blockers.push(t("Se detecto una fuente GPS sospechosa. Desactiva ubicacion simulada antes de registrar.", "Suspicious GPS source detected. Disable simulated location before registering."))
    if (isSupervisora && !supervisorShiftRestaurantId) {
      blockers.push(
        t("Selecciona un restaurante para tu turno.", "Select a restaurant for your shift.")
      )
    }
    if (typeof coords?.accuracyMeters === "number" && coords.accuracyMeters > MAX_GPS_ACCURACY_METERS) {
      blockers.push(
        t(
          `La precision GPS es baja (${Math.round(coords.accuracyMeters)}m). Ubicate en un lugar abierto e intenta de nuevo.`,
          `GPS accuracy too low (${Math.round(coords.accuracyMeters)}m). Move to open sky and retry.`
        )
      )
    }
    if (!photo) blockers.push(t("Debes capturar evidencia fotografica.", "You must capture photo evidence."))
    if (!shiftOtpReady) {
      blockers.push(
        t(
          "Debes validar OTP del telefono para iniciar/finalizar turno.",
          "Phone OTP verification is required to start/end shift."
        )
      )
    }
    if (!healthAnswered) {
      blockers.push(
        activeShift
          ? t("Debes responder la condicion de salud de salida.", "You must answer the exit health condition.")
          : t("Debes responder la condicion de salud de ingreso.", "You must answer the entry health condition.")
      )
    }
    if (healthDeclarationRequired && !healthDeclarationProvided) {
      blockers.push(t("Debes registrar una declaracion cuando la condicion de salud no es optima.", "You must provide a declaration when health condition is not optimal."))
    }
    if (!activeShift && !startChecklistComplete) {
      blockers.push(t("Completa todas las preguntas del checklist de inicio.", "Complete all start checklist questions."))
    }
    if (activeShift && !endChecklistComplete) {
      blockers.push(t("Completa todas las preguntas del checklist de salida.", "Complete all end checklist questions."))
    }
    if (activeShift && !hasStartEvidence) {
      blockers.push(
        t(
          "No puedes finalizar turno hasta cargar evidencia obligatoria de inicio.",
          "You cannot end shift until mandatory start evidence is uploaded."
        )
      )
    }
    if (!activeShift && geofenceValidation && !geofenceValidation.withinGeofence) {
      blockers.push(
        t(
          `Estas fuera de la geocerca permitida del restaurante (${Math.round(geofenceValidation.distanceMeters)}m del punto, maximo ${Math.round(
            geofenceValidation.allowedMeters
          )}m).`,
          `Outside allowed restaurant geofence (${Math.round(geofenceValidation.distanceMeters)}m from site, max ${Math.round(
            geofenceValidation.allowedMeters
          )}m).`
        )
      )
    }
    if (processing) blockers.push(t("Hay una accion en curso.", "There is an action in progress."))
    return blockers
  }, [
    coords,
    photo,
    healthAnswered,
    healthDeclarationRequired,
    healthDeclarationProvided,
    processing,
    shiftOtpReady,
    activeShift,
    hasStartEvidence,
    startChecklistComplete,
    endChecklistComplete,
    geofenceValidation,
    isSupervisora,
    supervisorShiftRestaurantId,
    t,
  ])

  const shiftOverlayLines = [
    `${t("Usuario", "User")}: ${currentUserId ?? t("desconocido", "unknown")}`,
    `${t("Empleado", "Employee")}: ${currentUserId ?? t("desconocido", "unknown")}`,
    `${t("Restaurante", "Restaurant")}: ${expectedRestaurantId ?? "-"}`,
    `${t("Turno", "Shift")}: ${activeShift ? `#${activeShift.id}` : t("inicio", "start")}`,
    `${t("Fase", "Phase")}: ${activeShift ? t("fin-turno", "shift-end") : t("inicio-turno", "shift-start")}`,
    coords ? `GPS: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : t("GPS: pendiente", "GPS: pending"),
  ]

  const loadEmployeeData = useCallback(async (page: number, options?: { includeSchedule?: boolean }) => {
    setLoadingData(true)
    try {
      const includeSchedule = options?.includeSchedule ?? true
      const scheduledPromise = includeSchedule ? listMyScheduledShifts(100) : Promise.resolve([] as ScheduledShift[])
      const [active, historyResult, scheduledResult] = await Promise.all([
        getMyActiveShift(),
        getMyShiftHistory(page, HISTORY_PAGE_SIZE),
        scheduledPromise,
      ])
      setActiveShift(active)
      setHistory(historyResult.rows)
      setHistoryTotalPages(historyResult.totalPages)
      setScheduledShifts(scheduledResult)
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo cargar la informacion de turnos.", "Could not load shift information.")))
    } finally {
      setLoadingData(false)
    }
  }, [showToast, t])

  const loadSupervisorData = useCallback(async () => {
    setLoadingSupervisor(true)
    try {
      const rows = await getActiveShiftsForSupervision(30)
      setSupervisorRows(rows)
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudieron cargar los turnos activos.", "Could not load active shifts.")))
    } finally {
      setLoadingSupervisor(false)
    }
  }, [showToast, t])

  const loadSupervisionScheduledShifts = useCallback(async () => {
    if (!canOperateSupervisor) return
    try {
      const rows = await listScheduledShifts(120)
      setSupervisionScheduledShifts(rows)
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudieron cargar los turnos programados.", "Could not load scheduled shifts.")))
    }
  }, [canOperateSupervisor, showToast, t])

  const loadKnownRestaurants = useCallback(async () => {
    try {
      const rows = await listRestaurants({ includeInactive: false })
      setKnownRestaurants(rows)
    } catch {
      // Best effort: backend remains source of truth for geofence validation.
    }
  }, [])

  const loadPresenceRestaurants = useCallback(async () => {
    if (!canOperateSupervisor) return
    try {
      const items = isSuperAdmin
        ? (await listRestaurants())
            .map(item => ({
              id: Number(item.id),
              name: item.name ?? `Restaurant #${item.id}`,
            }))
            .filter(item => Number.isFinite(item.id))
        : await listMySupervisorRestaurants()

      setPresenceRestaurants(items)
      setPresenceRestaurantId(prev => {
        if (items.length === 0) return null
        if (prev !== null && items.some(item => item.id === prev)) return prev
        return items[0].id
      })
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudieron cargar los restaurantes para presencia de supervision.", "Could not load restaurants for supervisor presence.")))
    }
  }, [canOperateSupervisor, isSuperAdmin, showToast, t])

  useEffect(() => {
    if (!canOperateShift) return
    void loadEmployeeData(historyPage, { includeSchedule: isEmpleado })
  }, [historyPage, canOperateShift, isEmpleado, loadEmployeeData])

  useEffect(() => {
    if (!canOperateShift) return
    getOrCreateDeviceFingerprint()
    setShiftOtpReady(Boolean(getShiftOtpToken()))
  }, [canOperateShift])

  useEffect(() => {
    if (!canOperateSupervisor) return
    void loadSupervisorData()
  }, [canOperateSupervisor, loadSupervisorData])

  useEffect(() => {
    if (!canOperateSupervisor) return
    void loadSupervisionScheduledShifts()
  }, [canOperateSupervisor, loadSupervisionScheduledShifts])

  useEffect(() => {
    if (!canOperateSupervisor) return
    void loadPresenceRestaurants()
  }, [canOperateSupervisor, loadPresenceRestaurants])

  useEffect(() => {
    if (!isSupervisora) return
    if (supervisorShiftRestaurantId) return
    if (presenceRestaurants.length === 0) return
    setSupervisorShiftRestaurantId(presenceRestaurants[0].id)
  }, [isSupervisora, presenceRestaurants, supervisorShiftRestaurantId])

  useEffect(() => {
    void loadKnownRestaurants()
  }, [loadKnownRestaurants])

  useEffect(() => {
    let mounted = true
    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!mounted) return
      setCurrentUserId(user?.id ?? null)
    }
    void loadUser()
    return () => {
      mounted = false
    }
  }, [])

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true)
    try {
      if (canOperateEmployee) {
        const items = await listMyOperationalTasks(40)
        setEmployeeTasks(items)
      }
      if (canOperateSupervisor) {
        const restaurantId = staffRestaurantId ?? presenceRestaurants[0]?.id ?? null
        if (restaurantId) {
          const items = await listSupervisorOperationalTasks(60, restaurantId)
          setSupervisorTasks(items)
        } else {
          setSupervisorTasks([])
        }
      }
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudieron cargar las tareas operativas.", "Could not load operational tasks.")))
    } finally {
      setLoadingTasks(false)
    }
  }, [canOperateEmployee, canOperateSupervisor, presenceRestaurants, showToast, staffRestaurantId, t])

  const loadEmployeeSelfServiceDashboard = useCallback(async () => {
    if (!canOperateEmployee) return
    try {
      const payload = await getEmployeeSelfDashboard()
      setEmployeeDashboard(payload)
    } catch {
      // Keep UX resilient while backend rollout converges.
    }
  }, [canOperateEmployee])

  const loadPresenceLogs = useCallback(async () => {
    if (!canOperateSupervisor) return
    try {
      const rows = await listMySupervisorPresence(20)
      setSupervisorPresence(rows)
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudieron cargar los registros de presencia de supervision.", "Could not load supervisor presence records.")))
    }
  }, [canOperateSupervisor, showToast, t])

  const loadStaffAssignmentContext = useCallback(async () => {
    if (!canOperateSupervisor) return
    try {
      const [profiles, restaurants] = await Promise.all([
        listUserProfiles(),
        isSuperAdmin
          ? (async () => {
              const rows = await listRestaurants({ includeInactive: false })
              return rows
                .map(item => ({ id: Number(item.id), name: item.name ?? `Restaurant #${item.id}` }))
                .filter(item => Number.isFinite(item.id))
            })()
          : listMySupervisorRestaurants(),
      ])

      const employees = profiles.filter(item => item.role === "empleado" && item.is_active !== false)
      setStaffUsers(employees)
      setStaffRestaurants(restaurants)

      const nextRestaurantId = restaurants[0]?.id ?? null
      setStaffRestaurantId(prev => (prev && restaurants.some(item => item.id === prev) ? prev : nextRestaurantId))
      setStaffUserId(prev => (prev && employees.some(item => item.id === prev) ? prev : employees[0]?.id ?? ""))
      setSupervisorScheduleRestaurantId(prev => (prev && restaurants.some(item => item.id === prev) ? prev : nextRestaurantId))
      setSupervisorScheduleEmployeeId(prev => (prev && employees.some(item => item.id === prev) ? prev : employees[0]?.id ?? ""))
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo cargar asignacion de personal.", "Could not load staff assignment context.")))
    }
  }, [canOperateSupervisor, isSuperAdmin, showToast, t])

  const loadStaffAssignments = useCallback(async () => {
    if (!canOperateSupervisor || !staffRestaurantId) {
      setStaffAssignments([])
      return
    }
    try {
      const rows = await listRestaurantEmployees(String(staffRestaurantId), "employee")
      setStaffAssignments(rows.filter((row): row is RestaurantEmployee => row !== null))
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo cargar el personal asignado.", "Could not load assigned staff.")))
    }
  }, [canOperateSupervisor, showToast, staffRestaurantId, t])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  useEffect(() => {
    if (!selectedTaskId) return
    if (!employeeTasks.some(task => task.id === selectedTaskId)) {
      setSelectedTaskId(null)
      setTaskCoords(null)
      setTaskPhotoClose(null)
      setTaskPhotoMid(null)
      setTaskPhotoWide(null)
    }
  }, [employeeTasks, selectedTaskId])

  useEffect(() => {
    void loadPresenceLogs()
  }, [loadPresenceLogs])

  useEffect(() => {
    void loadStaffAssignmentContext()
  }, [loadStaffAssignmentContext])

  useEffect(() => {
    void loadStaffAssignments()
  }, [loadStaffAssignments])

  useEffect(() => {
    void loadEmployeeSelfServiceDashboard()
  }, [loadEmployeeSelfServiceDashboard])

  const uploadEvidence = async (
    prefix: string,
    blob: Blob,
    position: Coordinates,
    options?: {
      extension?: string
    }
  ) => {
    if (!currentUserId) throw new Error(t("No se encontro el usuario autenticado.", "Authenticated user was not found."))
    const timestamp = new Date().toISOString().replaceAll(":", "-")
    const coordTag = `${position.lat.toFixed(6)}_${position.lng.toFixed(6)}`
    const rawExtension = (options?.extension ?? "jpg").replace(/^\./, "").toLowerCase()
    const extension = rawExtension.length > 0 ? rawExtension : "jpg"
    const fileName = `${prefix}-${timestamp}-${coordTag}.${extension}`
    const filePath = `users/${currentUserId}/${prefix}/${fileName}`

    const evidenceHash = await sha256Hex(blob)
    const evidenceMimeType = blob.type || "image/jpeg"
    const evidenceSizeBytes = blob.size

    await uploadEvidenceObject(filePath, blob, {
      upsert: false,
      contentType: evidenceMimeType,
    })
    return { filePath, evidenceHash, evidenceMimeType, evidenceSizeBytes }
  }

  const resetEvidenceAndLocation = () => {
    setCoords(null)
    setPhoto(null)
  }

  const resetTaskEvidenceCapture = () => {
    setTaskCoords(null)
    setTaskPhotoClose(null)
    setTaskPhotoMid(null)
    setTaskPhotoWide(null)
  }

  const handleSendShiftOtp = async () => {
    setSendingOtp(true)
    try {
      await sendShiftPhoneOtp()
      showToast("success", t("Codigo OTP enviado. Revisa tu telefono.", "OTP code sent. Check your phone."))
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo enviar OTP.", "Could not send OTP.")))
    } finally {
      setSendingOtp(false)
    }
  }

  const handleVerifyShiftOtp = async () => {
    if (!otpCode.trim()) {
      showToast("info", t("Ingresa el codigo OTP.", "Enter OTP code."))
      return
    }

    setVerifyingOtp(true)
    try {
      await verifyShiftPhoneOtp({ code: otpCode })
      setShiftOtpReady(true)
      setOtpVerifiedAt(new Date().toISOString())
      setOtpCode("")
      showToast("success", t("Telefono verificado. Ya puedes operar turnos.", "Phone verified. You can now operate shifts."))
    } catch (error: unknown) {
      setShiftOtpReady(false)
      showToast("error", extractErrorMessage(error, t("No se pudo verificar OTP.", "Could not verify OTP.")))
    } finally {
      setVerifyingOtp(false)
    }
  }

  const handleResetShiftOtp = () => {
    clearShiftOtpToken()
    setShiftOtpReady(false)
    setOtpVerifiedAt(null)
    setOtpCode("")
    showToast("info", t("Verificacion OTP reiniciada para este dispositivo/sesion.", "OTP verification reset for this device/session."))
  }

  const handleStart = async (overrideRestaurantId?: number | null) => {
    if (!canSubmit || !coords) return
    setProcessing(true)
    let startedShiftId: number | null = null

    try {
      if (startFitForWork === null) throw new Error(t("Debes confirmar que estas apto para iniciar el turno.", "You must confirm you are fit for work at shift start."))

      const latestActive = await getMyActiveShift()
      if (latestActive) {
        setActiveShift(latestActive)
        throw new Error(t("Ya existe un turno activo. Finalizalo antes de iniciar otro.", "There is already an active shift. End it before starting another."))
      }

      if (!photo) throw new Error(t("Debes capturar evidencia fotografica.", "You must capture photo evidence."))
      const currentRestaurantId = overrideRestaurantId ?? getCurrentScheduledRestaurantId(scheduledShifts)
      if (isSupervisora && !currentRestaurantId) {
        throw new Error(t("Selecciona un restaurante para iniciar tu turno.", "Select a restaurant to start your shift."))
      }
      const shiftId = Number(
        await startShift({
          restaurantId: currentRestaurantId,
          lat: coords.lat,
          lng: coords.lng,
          fitForWork: startFitForWork,
          declaration: startHealthDeclaration.trim() || null,
        })
      )
      startedShiftId = shiftId

      await uploadShiftEvidence({
        shiftId,
        type: "inicio",
        file: photo,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracyMeters,
      })

      if (startObservation.trim()) {
        await createShiftIncident(String(shiftId), `[INGRESO] ${startObservation.trim()}`)
      }

      showToast("success", t("Turno iniciado correctamente.", "Shift started successfully."))
      resetEvidenceAndLocation()
      setStartObservation("")
      setStartFitForWork(null)
      setStartPpeReady(null)
      setStartNoSymptoms(null)
      setStartHealthDeclaration("")
      setHistoryPage(1)
      await loadEmployeeData(1, { includeSchedule: isEmpleado })
      await loadEmployeeSelfServiceDashboard()
      await loadTasks()
      await loadSupervisorData()
    } catch (error: unknown) {
      if (startedShiftId) {
        await loadEmployeeData(1, { includeSchedule: isEmpleado })
      }
      if (isConsentPendingError(error)) {
        showToast("error", t("Consentimiento pendiente: acepta terminos de tratamiento de datos para operar turnos.", "Consent pending: accept data processing terms to operate shifts."))
        return
      }
      showToast("error", extractErrorMessage(error, t("No se pudo iniciar el turno.", "Could not start shift.")))
    } finally {
      setProcessing(false)
    }
  }

  const handleEnd = async () => {
    if (!canSubmit || !coords || !activeShift) return
    setProcessing(true)

    try {
      if (!hasStartEvidence) {
        throw new Error(
          t(
            "No puedes finalizar turno: falta evidencia obligatoria de inicio.",
            "You cannot end shift: mandatory start evidence is missing."
          )
        )
      }

      if (endFitForWork === null) throw new Error(t("Debes confirmar tu condicion al finalizar el turno.", "You must confirm your condition when ending shift."))
      if (!endFitForWork && !endHealthDeclaration.trim()) {
        throw new Error(t("Debes describir incidentes si tu condicion de salida no es optima.", "You must describe incidents if your end condition is not optimal."))
      }

      if (!photo) throw new Error(t("Debes capturar evidencia fotografica.", "You must capture photo evidence."))
      await uploadShiftEvidence({
        shiftId: Number(activeShift.id),
        type: "fin",
        file: photo,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracyMeters,
      })
      await endShift({
        shiftId: activeShift.id,
        lat: coords.lat,
        lng: coords.lng,
        fitForWork: endFitForWork,
        declaration: endHealthDeclaration.trim() || null,
      })

      if (endObservation.trim()) {
        await createShiftIncident(activeShift.id, `[SALIDA] ${endObservation.trim()}`)
      }

      showToast("success", t("Turno finalizado correctamente.", "Shift ended successfully."))
      resetEvidenceAndLocation()
      setEndObservation("")
      setEndFitForWork(null)
      setEndIncidentsOccurred(null)
      setEndAreaDelivered(null)
      setEndHealthDeclaration("")
      setHistoryPage(1)
      await loadEmployeeData(1, { includeSchedule: isEmpleado })
      await loadEmployeeSelfServiceDashboard()
      await loadTasks()
      await loadSupervisorData()
    } catch (error: unknown) {
      if (isConsentPendingError(error)) {
        showToast("error", t("Consentimiento pendiente: acepta terminos de tratamiento de datos para operar turnos.", "Consent pending: accept data processing terms to operate shifts."))
        return
      }
      showToast("error", extractErrorMessage(error, t("No se pudo finalizar el turno.", "Could not end shift.")))
    } finally {
      setProcessing(false)
    }
  }

  const handleStatusChange = async (shiftId: string, status: string) => {
    try {
      await updateShiftStatus(shiftId, status)
      showToast("success", t(`Turno actualizado a ${status}.`, `Shift updated to ${status}.`))
      await loadSupervisorData()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo actualizar el estado del turno.", "Could not update shift status.")))
    }
  }

  const handleCreateIncident = async (shiftId: string) => {
    const note = (incidentNotes[shiftId] ?? "").trim()
    if (!note) {
      showToast("info", t("Escribe un incidente antes de guardar.", "Write an incident before saving."))
      return
    }

    try {
      const incident = await createShiftIncident(shiftId, note)
      setIncidentNotes(prev => ({ ...prev, [shiftId]: "" }))
      setIncidentHistory(prev => ({
        ...prev,
        [shiftId]: [incident, ...(prev[shiftId] ?? [])],
      }))
      showToast("success", t("Incidente guardado.", "Incident saved."))
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo guardar el incidente.", "Could not save incident.")))
    }
  }

  const loadIncidentsForShift = async (shiftId: string) => {
    if (incidentHistory[shiftId]) return
    try {
      const rows = await getShiftIncidents(shiftId)
      setIncidentHistory(prev => ({ ...prev, [shiftId]: rows }))
    } catch {
      // no-op
    }
  }

  const handleCreateEmployeeIncident = async () => {
    const note = employeeIncident.trim()
    if (!activeShift || !note) {
      showToast("info", t("Escribe una nota antes de guardar.", "Write a note before saving."))
      return
    }

    setCreatingEmployeeIncident(true)
    try {
      try {
        await createEmployeeObservation({
          shiftId: activeShift.id,
          observationType: employeeObservationType,
          message: note,
        })
      } catch {
        await createShiftIncident(activeShift.id, `[EMPLEADO/${employeeObservationType.toUpperCase()}] ${note}`)
      }
      setEmployeeIncident("")
      showToast("success", t("Nota guardada correctamente.", "Note saved successfully."))
      await loadEmployeeSelfServiceDashboard()
      await loadSupervisorData()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo guardar la nota.", "Could not save note.")))
    } finally {
      setCreatingEmployeeIncident(false)
    }
  }

  const handleCreateTaskForShift = async (row: SupervisorShiftRow) => {
    const draft = newTaskByShift[row.id]
    const title = draft?.title?.trim() ?? ""
    const description = draft?.description?.trim() ?? ""
    const dueAt = draft?.dueAt?.trim() ?? ""

    if (!title || !description) {
      showToast("info", t("El titulo y la descripcion de la tarea son obligatorios.", "Task title and description are required."))
      return
    }
    if (!row.restaurant_id || !row.employee_id) {
      showToast("error", t("El turno no tiene relacion de restaurante/empleado.", "Shift is missing restaurant/employee relation."))
      return
    }

    setCreatingTaskForShift(row.id)
    try {
      await createOperationalTask({
        shiftId: Number(row.id),
        restaurantId: Number(row.restaurant_id),
        assignedEmployeeId: row.employee_id,
        title,
        description,
        priority: draft?.priority ?? "normal",
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      })
      setNewTaskByShift(prev => ({
        ...prev,
        [row.id]: { title: "", description: "", priority: "normal", dueAt: "" },
      }))
      showToast("success", t("Tarea operativa creada.", "Operational task created."))
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo crear la tarea.", "Could not create task.")))
    } finally {
      setCreatingTaskForShift(null)
    }
  }

  const handleSetTaskInProgress = async (taskId: number) => {
    try {
      await markTaskInProgress(taskId)
      showToast("success", t("Tarea marcada en progreso.", "Task marked as in progress."))
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo actualizar el estado de la tarea.", "Could not update task status.")))
    }
  }

  const handleCompleteTask = async () => {
    if (!selectedTaskId) {
      showToast("info", t("Selecciona una tarea para completar.", "Select a task to complete."))
      return
    }
    if (!taskCoords || !taskPhotoClose || !taskPhotoMid || !taskPhotoWide) {
      showToast("info", t("Completar una tarea requiere GPS y 3 evidencias: primer plano, plano medio y vista general.", "Completing a task requires GPS and 3 evidences: close-up, mid-range, and wide overview."))
      return
    }

    setProcessingTask(true)
    try {
      const [closeEvidence, midEvidence, wideEvidence] = await Promise.all([
        uploadEvidence("task-close", taskPhotoClose, taskCoords),
        uploadEvidence("task-mid", taskPhotoMid, taskCoords),
        uploadEvidence("task-wide", taskPhotoWide, taskCoords),
      ])

      const manifestPayload = {
        version: 1,
        task_id: selectedTaskId,
        captured_at: new Date().toISOString(),
        captured_by: currentUserId,
        gps: {
          lat: taskCoords.lat,
          lng: taskCoords.lng,
        },
        evidences: [
          { shot: "close_up" as TaskEvidenceShotKey, ...closeEvidence },
          { shot: "mid_range" as TaskEvidenceShotKey, ...midEvidence },
          { shot: "wide_general" as TaskEvidenceShotKey, ...wideEvidence },
        ],
      }

      const manifestBlob = new Blob([JSON.stringify(manifestPayload, null, 2)], {
        type: "application/json",
      })
      const manifestUpload = await requestTaskManifestUpload(selectedTaskId)
      await uploadTaskManifestViaSignedToken({
        bucket: manifestUpload.bucket,
        path: manifestUpload.path,
        token: manifestUpload.token,
        file: manifestBlob,
      })

      await completeOperationalTask({
        taskId: selectedTaskId,
        evidencePath: manifestUpload.path,
        evidenceHash: "",
        evidenceMimeType: manifestUpload.requiredMime,
        evidenceSizeBytes: manifestBlob.size,
      })
      resetTaskEvidenceCapture()
      setSelectedTaskId(null)
      showToast("success", t("Tarea completada con evidencia triple.", "Task completed with triple evidence."))
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo completar la tarea.", "Could not complete task.")))
    } finally {
      setProcessingTask(false)
    }
  }

  const closeTaskDetailModal = () => {
    setTaskDetailModalTask(null)
    setTaskDetailManifest(null)
    setTaskDetailManifestError(null)
    setLoadingTaskDetailManifest(false)
  }

  const handleOpenTaskDetail = async (task: OperationalTask) => {
    setTaskDetailModalTask(task)
    setTaskDetailManifest(null)
    setTaskDetailManifestError(null)
    setLoadingTaskDetailManifest(true)

    try {
      const manifest = await fetchTaskEvidenceManifest(task)
      const sortedEvidences = [...manifest.evidences].sort(
        (left, right) => (TASK_SHOT_ORDER[left.shot] ?? 99) - (TASK_SHOT_ORDER[right.shot] ?? 99)
      )
      setTaskDetailManifest({
        ...manifest,
        evidences: sortedEvidences,
      })
    } catch (error: unknown) {
      setTaskDetailManifestError(extractErrorMessage(error, t("No se pudieron cargar los detalles de evidencia de la tarea.", "Could not load task evidence details.")))
    } finally {
      setLoadingTaskDetailManifest(false)
    }
  }

  const handleRegisterPresence = async () => {
    if (!presenceRestaurantId) {
      showToast("info", t("Selecciona un restaurante para registrar entrada/salida de supervision.", "Select a restaurant to register supervisor entry/exit."))
      return
    }
    if (!presenceCoords || !presencePhoto) {
      showToast("info", t("El registro de supervision requiere GPS y evidencia fotografica.", "Supervisor registration requires GPS and photo evidence."))
      return
    }

    setRegisteringPresence(true)
    try {
      const prefix = presencePhase === "start" ? "supervisor-start" : "supervisor-end"
      const { filePath, evidenceHash, evidenceMimeType, evidenceSizeBytes } = await uploadEvidence(prefix, presencePhoto, presenceCoords)
      await registerSupervisorPresence({
        restaurantId: presenceRestaurantId,
        phase: presencePhase,
        lat: presenceCoords.lat,
        lng: presenceCoords.lng,
        notes: presenceNotes.trim() || null,
        evidencePath: filePath,
        evidenceHash,
        evidenceMimeType,
        evidenceSizeBytes,
      })
      setPresenceNotes("")
      setPresenceCoords(null)
      setPresencePhoto(null)
      showToast("success", t("Presencia de supervision registrada.", "Supervisor presence registered."))
      await loadPresenceLogs()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo registrar la presencia de supervision.", "Could not register supervisor presence.")))
    } finally {
      setRegisteringPresence(false)
    }
  }

  const handleAssignStaff = async () => {
    if (!staffRestaurantId || !staffUserId) {
      showToast("info", t("Selecciona restaurante y empleado.", "Select restaurant and employee."))
      return
    }

    setAssigningStaff(true)
    try {
      await assignEmployeeToRestaurant(String(staffRestaurantId), staffUserId, "employee")
      showToast("success", t("Empleado asignado al restaurante.", "Employee assigned to restaurant."))
      await loadStaffAssignments()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo asignar personal.", "Could not assign staff.")))
    } finally {
      setAssigningStaff(false)
    }
  }

  const handleUnassignStaff = async (userId: string) => {
    if (!staffRestaurantId) return
    setAssigningStaff(true)
    try {
      await unassignEmployeeFromRestaurant(String(staffRestaurantId), userId, "employee")
      showToast("success", t("Empleado desasignado.", "Employee unassigned."))
      await loadStaffAssignments()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo desasignar personal.", "Could not unassign staff.")))
    } finally {
      setAssigningStaff(false)
    }
  }

  const handleScheduleSupervisorShift = async () => {
    if (!supervisorScheduleEmployeeId || !supervisorScheduleRestaurantId || !supervisorScheduleStart || !supervisorScheduleEnd) {
      showToast("info", t("Completa empleado, restaurante, inicio y fin.", "Complete employee, restaurant, start, and end."))
      return
    }

    const startIso = new Date(supervisorScheduleStart).toISOString()
    const endIso = new Date(supervisorScheduleEnd).toISOString()
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      showToast("info", t("La hora de fin debe ser posterior a la hora de inicio.", "End time must be after start time."))
      return
    }

    setSupervisorScheduling(true)
    try {
      await assignScheduledShift({
        employeeId: supervisorScheduleEmployeeId,
        restaurantId: String(supervisorScheduleRestaurantId),
        scheduledStartIso: startIso,
        scheduledEndIso: endIso,
        notes: supervisorScheduleNotes.trim() || undefined,
      })
      showToast("success", t("Turno programado correctamente.", "Shift scheduled successfully."))
      setSupervisorScheduleNotes("")
      await loadSupervisionScheduledShifts()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo programar el turno.", "Could not schedule shift.")))
    } finally {
      setSupervisorScheduling(false)
    }
  }

  const handleCancelSupervisionScheduledShift = async (scheduledShift: ScheduledShift) => {
    try {
      await cancelScheduledShift(scheduledShift.id, scheduledShift.notes ?? undefined)
      showToast("success", t("Turno programado cancelado.", "Scheduled shift cancelled."))
      await loadSupervisionScheduledShifts()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo cancelar el turno programado.", "Could not cancel scheduled shift.")))
    }
  }

  const handleStartEditSupervisionScheduled = (scheduledShift: ScheduledShift) => {
    setEditingSupervisionScheduledId(scheduledShift.id)
    setEditSupervisionScheduledStart(
      scheduledShift.scheduled_start ? new Date(scheduledShift.scheduled_start).toISOString().slice(0, 16) : ""
    )
    setEditSupervisionScheduledEnd(
      scheduledShift.scheduled_end ? new Date(scheduledShift.scheduled_end).toISOString().slice(0, 16) : ""
    )
  }

  const handleSaveReprogramSupervisionScheduled = async () => {
    if (!editingSupervisionScheduledId || !editSupervisionScheduledStart || !editSupervisionScheduledEnd) {
      showToast("info", t("Inicio/fin son obligatorios para reprogramar.", "Start/end are required to reschedule."))
      return
    }

    const startIso = new Date(editSupervisionScheduledStart).toISOString()
    const endIso = new Date(editSupervisionScheduledEnd).toISOString()
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      showToast("info", t("La hora de fin debe ser mayor que la hora de inicio.", "End time must be greater than start time."))
      return
    }

    try {
      await reprogramScheduledShift({
        scheduledShiftId: editingSupervisionScheduledId,
        scheduledStartIso: startIso,
        scheduledEndIso: endIso,
      })
      showToast("success", t("Turno programado reprogramado.", "Scheduled shift rescheduled."))
      setEditingSupervisionScheduledId(null)
      setEditSupervisionScheduledStart("")
      setEditSupervisionScheduledEnd("")
      await loadSupervisionScheduledShifts()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo reprogramar el turno.", "Could not reschedule shift.")))
    }
  }

  return (
    <ProtectedRoute>
      <div className="space-y-5">
        <Card title={t("Turnos", "Shifts")} subtitle={t("Operacion de empleado y supervision en un solo modulo.", "Employee operation and supervision in one module.")} />

        {canOperateShift && (
          <section className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">
              {isSupervisora ? t("Operacion de supervisora", "Supervisor operations") : t("Operacion de empleado", "Employee operations")}
            </h2>

            {isEmpleado && (
              <>
                <Card
                  title={t("Mi panel", "My dashboard")}
                  subtitle={t("Asignacion, agenda, tareas y turno activo desde self-service.", "Assignment, schedule, tasks and active shift from self-service.")}
                >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <p className="text-xs text-slate-500">{t("Restaurantes", "Restaurants")}</p>
                  <p className="font-semibold text-slate-800">{employeeDashboard?.assigned_restaurants?.length ?? 0}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <p className="text-xs text-slate-500">{t("Agenda", "Schedule")}</p>
                  <p className="font-semibold text-slate-800">{employeeDashboard?.scheduled_shifts?.length ?? 0}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <p className="text-xs text-slate-500">{t("Tareas abiertas", "Open tasks")}</p>
                  <p className="font-semibold text-slate-800">{employeeDashboard?.pending_tasks_count ?? employeeDashboard?.pending_tasks_preview?.length ?? 0}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <p className="text-xs text-slate-500">{t("Turno activo", "Active shift")}</p>
                  <p className="font-semibold text-slate-800">#{employeeDashboard?.active_shift?.id ?? "-"}</p>
                </div>
              </div>
            </Card>

            {loadingData ? (
              <Skeleton className="h-24" />
            ) : activeShift ? (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {t("Turno activo desde", "Active shift since")} <b>{formatDateTime(activeShift.start_time)}</b>
                  </span>
                  <Badge variant="success">{t("Activo", "Active")}</Badge>
                </div>
                <p className="mt-2 text-xs text-emerald-900">
                  {t("Evidencia inicio", "Start evidence")}: {hasStartEvidence ? "OK" : t("Pendiente", "Pending")}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                {t("No tienes turnos activos en este momento.", "You do not have active shifts at this moment.")}
              </div>
            )}

            {pendingEmployeeTasks.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">
                  {t("Alerta operativa: tienes", "Operational alert: you have")} {pendingEmployeeTasks.length} {t("tarea(s) asignadas por supervision.", "task(s) assigned by supervisor.")}
                </p>
                <p className="mt-1 text-amber-800">
                  {t("Debes cerrar cada tarea con 3 evidencias especificas: primer plano, plano medio y vista general.", "You must close each task with 3 specific evidence shots: close-up, mid-range shot, and wide overview.")}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-900">
                  {pendingEmployeeTasks.slice(0, 3).map(task => (
                    <li key={task.id}>
                      #{task.id} {task.title} ({task.status})
                    </li>
                  ))}
                </ul>
              </div>
            )}

                <div className="grid gap-4 xl:grid-cols-2">
              <Card
                title={t("Restaurante y horario asignados", "Assigned restaurant and schedule")}
                subtitle={t("Verifica tu ubicacion y horario asignado.", "Check your assigned location and schedule.")}
              >
                {nextScheduledShift ? (
                  <div className="space-y-2 text-sm text-slate-700">
                    <p>
                      <span className="font-semibold">{t("ID restaurante:", "Restaurant ID:")}</span> #{nextScheduledShift.restaurant_id}
                    </p>
                    <p>
                      <span className="font-semibold">{t("Inicio:", "Start:")}</span> {formatDateTime(nextScheduledShift.scheduled_start)}
                    </p>
                    <p>
                      <span className="font-semibold">{t("Fin:", "End:")}</span> {formatDateTime(nextScheduledShift.scheduled_end)}
                    </p>
                    <p>
                      <span className="font-semibold">{t("Estado:", "Status:")}</span> {nextScheduledShift.status}
                    </p>
                    {currentScheduledRestaurant && currentScheduledRestaurant.geofence_radius_m !== null && (
                      <p>
                        <span className="font-semibold">{t("Radio de geocerca permitido:", "Allowed geofence radius:")}</span>{" "}
                        {Math.round(Number(currentScheduledRestaurant.geofence_radius_m))}m
                      </p>
                    )}
                    {coords && (
                      <p>
                        <span className="font-semibold">{t("Precision GPS:", "GPS accuracy:")}</span>{" "}
                        {typeof coords.accuracyMeters === "number"
                          ? `${Math.round(coords.accuracyMeters)}m`
                          : t("No reportada por el dispositivo", "Not reported by device")}
                      </p>
                    )}
                    {geofenceValidation && (
                      <p className={geofenceValidation.withinGeofence ? "text-emerald-700" : "text-rose-700"}>
                        <span className="font-semibold">{t("Validacion de geocerca:", "Geofence check:")}</span>{" "}
                        {geofenceValidation.withinGeofence
                          ? t(
                              `Dentro del area permitida (${Math.round(geofenceValidation.distanceMeters)}m del punto).`,
                              `Within allowed area (${Math.round(geofenceValidation.distanceMeters)}m from site).`
                            )
                          : t(
                              `Fuera del area permitida (${Math.round(geofenceValidation.distanceMeters)}m del punto, maximo ${Math.round(
                                geofenceValidation.allowedMeters
                              )}m).`,
                              `Outside allowed area (${Math.round(geofenceValidation.distanceMeters)}m from site, max ${Math.round(
                                geofenceValidation.allowedMeters
                              )}m).`
                            )}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">{t("No se encontro un horario asignado.", "No assigned schedule found.")}</p>
                )}
              </Card>
            </div>
          </>
        )}

            {isSupervisora && (
              <Card
                title={t("Restaurante para turno propio", "Restaurant for your shift")}
                subtitle={t("Selecciona un restaurante autorizado antes de registrar tu turno.", "Select an authorized restaurant before registering your shift.")}
              >
                <div className="space-y-2">
                  <select
                    value={supervisorShiftRestaurantId ?? ""}
                    onChange={event => setSupervisorShiftRestaurantId(Number(event.target.value) || null)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">{t("Seleccionar restaurante", "Select restaurant")}</option>
                    {presenceRestaurants.map(restaurant => (
                      <option key={restaurant.id} value={restaurant.id}>
                        {restaurant.name}
                      </option>
                    ))}
                  </select>

                  {presenceRestaurants.length === 0 && (
                    <p className="text-xs text-amber-700">
                      {t("No hay restaurantes asignados para tu turno.", "No assigned restaurants for your shift.")}
                    </p>
                  )}

                  {supervisorSelectedRestaurant?.geofence_radius_m !== null && supervisorSelectedRestaurant && (
                    <p className="text-xs text-slate-600">
                      {t("Radio de geocerca permitido", "Allowed geofence radius")}:{" "}
                      {Math.round(Number(supervisorSelectedRestaurant.geofence_radius_m))}m
                    </p>
                  )}

                  {coords && (
                    <p className="text-xs text-slate-600">
                      {t("Precision GPS", "GPS accuracy")}:{" "}
                      {typeof coords.accuracyMeters === "number"
                        ? `${Math.round(coords.accuracyMeters)}m`
                        : t("No reportada por el dispositivo", "Not reported by device")}
                    </p>
                  )}

                  {geofenceValidation && (
                    <p className={`text-xs ${geofenceValidation.withinGeofence ? "text-emerald-700" : "text-rose-700"}`}>
                      {geofenceValidation.withinGeofence
                        ? t(
                            `Dentro del area permitida (${Math.round(geofenceValidation.distanceMeters)}m del punto).`,
                            `Within allowed area (${Math.round(geofenceValidation.distanceMeters)}m from site).`
                          )
                        : t(
                            `Fuera del area permitida (${Math.round(geofenceValidation.distanceMeters)}m del punto, maximo ${Math.round(
                              geofenceValidation.allowedMeters
                            )}m).`,
                            `Outside allowed area (${Math.round(geofenceValidation.distanceMeters)}m from site, max ${Math.round(
                              geofenceValidation.allowedMeters
                            )}m).`
                          )}
                    </p>
                  )}
                </div>
              </Card>
            )}

            <Card title={t("Ubicacion GPS", "GPS location")} subtitle={t("Debes tener coordenadas validas para ejecutar acciones.", "You must have valid coordinates to execute actions.")}>
              <div className="mt-3">
                <GPSGuard onLocation={setCoords} />
              </div>
            </Card>

            <Card title={t("Evidencia fotografica", "Photo evidence")} subtitle={t("La foto se captura con camara y se carga a Storage.", "Photo is captured with camera and uploaded to Storage.")}>
              <div className="mt-3">
                <CameraCapture onCapture={setPhoto} overlayLines={shiftOverlayLines} />
              </div>
            </Card>

            <Card
              title={t("Accion principal", "Main action")}
              subtitle={activeShift ? t("Finalizar turno activo", "End active shift") : t("Iniciar nuevo turno", "Start new shift")}
            >
              <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={shiftOtpReady ? "success" : "warning"}>
                    {shiftOtpReady ? t("OTP verificado", "OTP verified") : t("OTP pendiente", "OTP pending")}
                  </Badge>
                  {otpVerifiedAt && (
                    <span className="text-xs text-slate-600">
                      {t("Validado", "Verified")}: {formatDateTime(otpVerifiedAt)}
                    </span>
                  )}
                </div>

                <p className="mt-2 text-xs text-slate-700">
                  {t(
                    "Debes completar OTP de telefono para iniciar/finalizar turno en este dispositivo.",
                    "Phone OTP must be completed to start/end shift on this device."
                  )}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void handleSendShiftOtp()} disabled={sendingOtp}>
                    {sendingOtp ? t("Enviando OTP...", "Sending OTP...") : t("Enviar OTP", "Send OTP")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleResetShiftOtp}>
                    {t("Reiniciar OTP", "Reset OTP")}
                  </Button>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_auto]">
                  <input
                    value={otpCode}
                    onChange={event => setOtpCode(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={t("Codigo OTP", "OTP code")}
                  />
                  <Button size="sm" variant="primary" onClick={() => void handleVerifyShiftOtp()} disabled={verifyingOtp}>
                    {verifyingOtp ? t("Verificando...", "Verifying...") : t("Verificar OTP", "Verify OTP")}
                  </Button>
                </div>
              </div>

              {!activeShift ? (
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-800">{t("Checklist de validacion de inicio", "Start validation checklist")}</p>
                  <div className="mt-2 space-y-2">
                    <div>
                      <p className="text-xs text-slate-600">{t("Tienes EPP completo para este turno?", "Do you have complete PPE for this shift?")}</p>
                      <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-4">
                        <label className="flex items-center gap-2"><input type="radio" name="start-ppe" checked={startPpeReady === true} onChange={() => setStartPpeReady(true)} />{t("Si", "Yes")}</label>
                        <label className="flex items-center gap-2"><input type="radio" name="start-ppe" checked={startPpeReady === false} onChange={() => setStartPpeReady(false)} />{t("No", "No")}</label>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-slate-600">{t("Estas libre de sintomas que impidan trabajo seguro?", "Are you free of symptoms that prevent safe work?")}</p>
                      <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-4">
                        <label className="flex items-center gap-2"><input type="radio" name="start-symptoms" checked={startNoSymptoms === true} onChange={() => setStartNoSymptoms(true)} />{t("Si", "Yes")}</label>
                        <label className="flex items-center gap-2"><input type="radio" name="start-symptoms" checked={startNoSymptoms === false} onChange={() => setStartNoSymptoms(false)} />{t("No", "No")}</label>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-800">{t("Checklist de validacion de salida", "End validation checklist")}</p>
                  <div className="mt-2 space-y-2">
                    <div>
                      <p className="text-xs text-slate-600">{t("Ocurrieron incidentes o eventos relevantes durante el turno?", "Did incidents or relevant events occur during the shift?")}</p>
                      <div className="mt-1 flex gap-4">
                        <label className="flex items-center gap-2"><input type="radio" name="end-incidents" checked={endIncidentsOccurred === true} onChange={() => setEndIncidentsOccurred(true)} />{t("Si", "Yes")}</label>
                        <label className="flex items-center gap-2"><input type="radio" name="end-incidents" checked={endIncidentsOccurred === false} onChange={() => setEndIncidentsOccurred(false)} />{t("No", "No")}</label>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-slate-600">{t("Entregaste el area y tareas pendientes a la operacion?", "Did you deliver the area and pending tasks to operation?")}</p>
                      <div className="mt-1 flex gap-4">
                        <label className="flex items-center gap-2"><input type="radio" name="end-delivery" checked={endAreaDelivered === true} onChange={() => setEndAreaDelivered(true)} />{t("Si", "Yes")}</label>
                        <label className="flex items-center gap-2"><input type="radio" name="end-delivery" checked={endAreaDelivered === false} onChange={() => setEndAreaDelivered(false)} />{t("No", "No")}</label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-medium text-slate-800">
                  {activeShift
                    ? t("Finalizaste el turno en buenas condiciones?", "Did you finish the shift in good condition?")
                    : t("Estas iniciando en buenas condiciones?", "Are you starting in good condition?")}
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={activeShift ? "end-fit-for-work" : "start-fit-for-work"}
                      checked={activeShift ? endFitForWork === true : startFitForWork === true}
                      onChange={() => {
                        if (activeShift) setEndFitForWork(true)
                        else setStartFitForWork(true)
                      }}
                    />
                    <span>{t("Si", "Yes")}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={activeShift ? "end-fit-for-work" : "start-fit-for-work"}
                      checked={activeShift ? endFitForWork === false : startFitForWork === false}
                      onChange={() => {
                        if (activeShift) setEndFitForWork(false)
                        else setStartFitForWork(false)
                      }}
                    />
                    <span>{t("No", "No")}</span>
                  </label>
                </div>

                {(activeShift ? endFitForWork === false : startFitForWork === false) && (
                  <textarea
                    rows={2}
                    value={activeShift ? endHealthDeclaration : startHealthDeclaration}
                    onChange={event =>
                      activeShift
                        ? setEndHealthDeclaration(event.target.value)
                        : setStartHealthDeclaration(event.target.value)
                    }
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
                    placeholder={t("Describe condicion de salud o incidente.", "Describe health condition or incident.")}
                  />
                )}
              </div>

              <div className="mt-3">
                <textarea
                  rows={3}
                  value={activeShift ? endObservation : startObservation}
                  onChange={event =>
                    activeShift ? setEndObservation(event.target.value) : setStartObservation(event.target.value)
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
                  placeholder={
                    activeShift
                      ? t("Observacion final (opcional)", "Final observation (optional)")
                      : t("Observacion inicial (opcional)", "Initial observation (optional)")
                  }
                />
              </div>

              <p className="mt-3 text-xs text-slate-500">
                {t(
                  "La marca de tiempo del registro la asigna el servidor al enviar la accion para garantizar la integridad de asistencia.",
                  "Registration timestamp is assigned by the server at submission time for attendance audit integrity."
                )}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {!activeShift ? (
                  <Button
                    onClick={() => void handleStart(isSupervisora ? supervisorShiftRestaurantId : undefined)}
                    disabled={!canSubmit}
                    variant="primary"
                  >
                    {processing ? t("Iniciando...", "Starting...") : t("Iniciar turno", "Start shift")}
                  </Button>
                ) : (
                  <Button onClick={handleEnd} disabled={!canSubmit} variant="danger">
                    {processing ? t("Finalizando...", "Ending...") : t("Finalizar turno", "End shift")}
                  </Button>
                )}
              </div>

              {submitBlockers.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
                  {submitBlockers.map(item => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </Card>

            {isEmpleado && activeShift && (
              <Card title={t("Registrar incidente", "Register incident")} subtitle={t("Si ocurre algo durante el turno, registralo aqui.", "If anything happens during the shift, register it here.")}>
                <div className="space-y-2">
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="employee-observation-type"
                        checked={employeeObservationType === "observation"}
                        onChange={() => setEmployeeObservationType("observation")}
                      />
                      {t("Observacion", "Observation")}
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="employee-observation-type"
                        checked={employeeObservationType === "alert"}
                        onChange={() => setEmployeeObservationType("alert")}
                      />
                      {t("Alerta", "Alert")}
                    </label>
                  </div>

                  <textarea
                    value={employeeIncident}
                    onChange={event => setEmployeeIncident(event.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
                    placeholder={t("Describe la nota o incidente...", "Describe the note or incident...")}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={creatingEmployeeIncident}
                    onClick={() => void handleCreateEmployeeIncident()}
                  >
                    {creatingEmployeeIncident ? t("Guardando...", "Saving...") : t("Guardar nota", "Save note")}
                  </Button>
                </div>
              </Card>
            )}

            {isEmpleado && (
              <Card title={t("Tareas asignadas", "Assigned tasks")} subtitle={t("Tareas operativas de supervision con cierre obligatorio por evidencia.", "Supervision operational tasks with mandatory evidence closure.")}>
              {loadingTasks ? (
                <Skeleton className="h-24" />
              ) : employeeTasks.length === 0 ? (
                <p className="text-sm text-slate-500">{t("No hay tareas asignadas pendientes.", "There are no pending assigned tasks.")}</p>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {employeeTasks.map(task => (
                      <div key={task.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <p className="font-semibold text-slate-800">{task.title}</p>
                        <p className="mt-1 text-slate-600">{task.description}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {t("Prioridad", "Priority")}: {task.priority} | {t("Estado", "Status")}: {task.status} | {t("Creada", "Created")}: {formatDateTime(task.created_at)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {task.status === "pending" && (
                            <Button size="sm" variant="secondary" onClick={() => void handleSetTaskInProgress(task.id)}>
                              {t("Iniciar tarea", "Start task")}
                            </Button>
                          )}
                          {task.status !== "completed" && (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => {
                                setSelectedTaskId(task.id)
                                resetTaskEvidenceCapture()
                              }}
                            >
                              {selectedTaskId === task.id ? t("Seleccionada", "Selected") : t("Seleccionar para completar", "Select to complete")}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedTaskId && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-medium text-slate-700">
                        {t("Evidencia de cierre de tarea", "Task closing evidence")} (#{selectedTaskId})
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {t("Requerido: GPS + 3 fotos (primer plano, plano medio, vista general).", "Required: GPS + 3 photos (close-up, mid-range, wide overview).")}
                      </p>

                      <div className="mt-3">
                        <GPSGuard onLocation={setTaskCoords} />
                      </div>

                      <div className="mt-3 grid gap-3 xl:grid-cols-3">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-700">{t("Primer plano", "Close-up")}</p>
                          <p className="mb-2 text-xs text-slate-500">{t("Captura un detalle directo del area intervenida.", "Capture a direct detail of the intervened area.")}</p>
                          <CameraCapture
                            onCapture={setTaskPhotoClose}
                            overlayLines={[
                              `${t("Usuario", "User")}: ${currentUserId ?? t("desconocido", "unknown")}`,
                              `${t("Empleado", "Employee")}: ${selectedTask?.assigned_employee_id ?? currentUserId ?? t("desconocido", "unknown")}`,
                              `${t("Restaurante", "Restaurant")}: ${selectedTask?.restaurant_id ?? "-"}`,
                              `${t("Turno", "Shift")}: ${selectedTask?.shift_id ?? "-"}`,
                              `${t("Tarea", "Task")}: ${selectedTaskId}`,
                              `${t("Toma", "Shot")}: close_up`,
                              taskCoords
                                ? `GPS: ${taskCoords.lat.toFixed(6)}, ${taskCoords.lng.toFixed(6)}`
                                : t("GPS: pendiente", "GPS: pending"),
                            ]}
                          />
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-700">{t("Plano medio", "Mid-range shot")}</p>
                          <p className="mb-2 text-xs text-slate-500">{t("Captura a distancia media mostrando contexto cercano.", "Capture from mid distance showing nearby context.")}</p>
                          <CameraCapture
                            onCapture={setTaskPhotoMid}
                            overlayLines={[
                              `${t("Usuario", "User")}: ${currentUserId ?? t("desconocido", "unknown")}`,
                              `${t("Empleado", "Employee")}: ${selectedTask?.assigned_employee_id ?? currentUserId ?? t("desconocido", "unknown")}`,
                              `${t("Restaurante", "Restaurant")}: ${selectedTask?.restaurant_id ?? "-"}`,
                              `${t("Turno", "Shift")}: ${selectedTask?.shift_id ?? "-"}`,
                              `${t("Tarea", "Task")}: ${selectedTaskId}`,
                              `${t("Toma", "Shot")}: mid_range`,
                              taskCoords
                                ? `GPS: ${taskCoords.lat.toFixed(6)}, ${taskCoords.lng.toFixed(6)}`
                                : t("GPS: pendiente", "GPS: pending"),
                            ]}
                          />
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-700">{t("Vista general", "Wide overview")}</p>
                          <p className="mb-2 text-xs text-slate-500">{t("Captura una vista panoramica final del espacio completo.", "Capture a final panoramic view of the full space.")}</p>
                          <CameraCapture
                            onCapture={setTaskPhotoWide}
                            overlayLines={[
                              `${t("Usuario", "User")}: ${currentUserId ?? t("desconocido", "unknown")}`,
                              `${t("Empleado", "Employee")}: ${selectedTask?.assigned_employee_id ?? currentUserId ?? t("desconocido", "unknown")}`,
                              `${t("Restaurante", "Restaurant")}: ${selectedTask?.restaurant_id ?? "-"}`,
                              `${t("Turno", "Shift")}: ${selectedTask?.shift_id ?? "-"}`,
                              `${t("Tarea", "Task")}: ${selectedTaskId}`,
                              `${t("Toma", "Shot")}: wide_general`,
                              taskCoords
                                ? `GPS: ${taskCoords.lat.toFixed(6)}, ${taskCoords.lng.toFixed(6)}`
                                : t("GPS: pendiente", "GPS: pending"),
                            ]}
                          />
                        </div>
                      </div>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                        <p>GPS: {taskCoords ? "OK" : t("Pendiente", "Pending")}</p>
                        <p>{t("Primer plano", "Close-up")}: {taskPhotoClose ? "OK" : t("Pendiente", "Pending")}</p>
                        <p>{t("Plano medio", "Mid-range shot")}: {taskPhotoMid ? "OK" : t("Pendiente", "Pending")}</p>
                        <p>{t("Vista general", "Wide overview")}: {taskPhotoWide ? "OK" : t("Pendiente", "Pending")}</p>
                      </div>

                      <div className="mt-3">
                        <Button variant="primary" onClick={() => void handleCompleteTask()} disabled={processingTask}>
                          {processingTask ? t("Completando...", "Completing...") : t("Completar tarea con evidencia triple", "Complete task with triple evidence")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              </Card>
            )}

            {isEmpleado && (
              <Card title={t("Historial de turnos", "Shift history")} subtitle={t("Vista paginada con estado y duracion.", "Paginated view with status and duration.")}>
              {loadingData ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-10" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <EmptyState
                  title={t("Sin historial", "No history")}
                  description={t("Cuando registres turnos apareceran aqui.", "When you register shifts, they will appear here.")}
                  actionLabel={t("Recargar", "Reload")}
                  onAction={() => void loadEmployeeData(historyPage, { includeSchedule: isEmpleado })}
                />
              ) : (
                <>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="pb-2 pr-3">{t("Inicio", "Start")}</th>
                          <th className="pb-2 pr-3">{t("Fin", "End")}</th>
                          <th className="pb-2 pr-3">{t("Estado", "Status")}</th>
                          <th className="pb-2 pr-3">{t("Duracion", "Duration")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(shift => (
                          <tr key={shift.id} className="border-b border-slate-100 text-sm text-slate-700">
                            <td className="py-2 pr-3">{formatDateTime(shift.start_time)}</td>
                            <td className="py-2 pr-3">{formatDateTime(shift.end_time)}</td>
                            <td className="py-2 pr-3">
                              <Badge variant={shift.end_time ? "neutral" : "success"}>
                                {shift.end_time ? t("Completado", "Completed") : t("Activo", "Active")}
                              </Badge>
                            </td>
                            <td className="py-2 pr-3">{formatDuration(shift.start_time, shift.end_time)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-xs text-slate-500">
                      <p>{t("Pagina", "Page")} {historyPage} {t("de", "of")} {historyTotalPages}</p>
                      <p>{t("Total trabajado (pagina actual)", "Total worked (current page)")}: {(totalWorkedMinutes / 60).toFixed(1)}h</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={historyPage <= 1 || loadingData}
                        onClick={() => setHistoryPage(prev => Math.max(1, prev - 1))}
                      >
                        {t("Anterior", "Previous")}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={historyPage >= historyTotalPages || loadingData}
                        onClick={() => setHistoryPage(prev => prev + 1)}
                      >
                        {t("Siguiente", "Next")}
                      </Button>
                    </div>
                  </div>
                </>
              )}
              </Card>
            )}

            {isEmpleado && (
              <Card title={t("Turnos programados", "Scheduled shifts")} subtitle={t("Agenda asignada para tus proximos periodos de trabajo.", "Agenda assigned for your upcoming work periods.")}>
              {scheduledShifts.length === 0 ? (
                <p className="text-sm text-slate-500">{t("No tienes turnos programados.", "You do not have scheduled shifts.")}</p>
              ) : (
                <div className="space-y-2">
                  {scheduledShifts.map(item => (
                    <div key={item.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      {formatDateTime(item.scheduled_start)} - {formatDateTime(item.scheduled_end)} |{" "}
                      {t("Estado", "Status")}: {item.status}
                    </div>
                  ))}
                </div>
              )}
              </Card>
            )}
          </section>
        )}

        {canOperateSupervisor && (
          <section className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">{t("Panel de supervision", "Supervision panel")}</h2>

            {(overdueSupervisorTasks.length > 0 || pendingPresenceClosures.length > 0) && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                {overdueSupervisorTasks.length > 0 && (
                  <p className="font-medium">
                    {t("Hay", "There are")} {overdueSupervisorTasks.length} {t("tarea(s) vencidas pendientes de cierre.", "overdue task(s) pending closure.")}
                  </p>
                )}
                {pendingPresenceClosures.length > 0 && (
                  <p className="mt-1">
                    {t("Tienes", "You have")} {pendingPresenceClosures.length} {t("restaurante(s) con entrada registrada pero sin salida hoy.", "restaurant(s) with entry registered but no exit today.")}
                  </p>
                )}
              </div>
            )}

            <Card
              title={t("Asignacion de personal", "Staff assignment")}
              subtitle={t("Asigna y desasigna empleados por restaurante autorizado.", "Assign and unassign employees by authorized restaurant.")}
            >
              <div className="grid gap-2 lg:grid-cols-3">
                <select
                  value={staffRestaurantId ?? ""}
                  onChange={event => setStaffRestaurantId(Number(event.target.value) || null)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">{t("Seleccionar restaurante", "Select restaurant")}</option>
                  {staffRestaurants.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  value={staffUserId}
                  onChange={event => setStaffUserId(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">{t("Seleccionar empleado", "Select employee")}</option>
                  {staffUsers.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.full_name ?? item.email ?? item.id}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" disabled={assigningStaff} onClick={() => void handleAssignStaff()}>
                  {assigningStaff ? t("Guardando...", "Saving...") : t("Asignar empleado", "Assign employee")}
                </Button>
              </div>

              {staffRestaurantId && (
                <div className="mt-3 space-y-2">
                  {staffAssignments.length === 0 ? (
                    <p className="text-sm text-slate-500">{t("Sin personal asignado para este restaurante.", "No staff assigned for this restaurant.")}</p>
                  ) : (
                    staffAssignments.map(item => {
                      const profile = staffUsers.find(user => user.id === item.user_id)
                      return (
                        <div key={`${item.restaurant_id}-${item.user_id}`} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                          <span>{profile?.full_name ?? profile?.email ?? item.user_id}</span>
                          <Button size="sm" variant="ghost" onClick={() => void handleUnassignStaff(item.user_id)}>
                            {t("Desasignar", "Unassign")}
                          </Button>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </Card>

            <Card
              title={t("Programar turno", "Schedule shift")}
              subtitle={t("Agenda turnos para empleados bajo supervision.", "Schedule shifts for supervised employees.")}
            >
              <div className="grid gap-2 lg:grid-cols-2">
                <select
                  value={supervisorScheduleEmployeeId}
                  onChange={event => setSupervisorScheduleEmployeeId(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">{t("Seleccionar empleado", "Select employee")}</option>
                  {staffUsers.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.full_name ?? item.email ?? item.id}
                    </option>
                  ))}
                </select>
                <select
                  value={supervisorScheduleRestaurantId ?? ""}
                  onChange={event => setSupervisorScheduleRestaurantId(Number(event.target.value) || null)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">{t("Seleccionar restaurante", "Select restaurant")}</option>
                  {staffRestaurants.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={supervisorScheduleStart}
                  onChange={event => setSupervisorScheduleStart(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="datetime-local"
                  value={supervisorScheduleEnd}
                  onChange={event => setSupervisorScheduleEnd(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <textarea
                  rows={2}
                  value={supervisorScheduleNotes}
                  onChange={event => setSupervisorScheduleNotes(event.target.value)}
                  className="lg:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t("Notas para el turno (opcional)", "Shift notes (optional)")}
                />
              </div>

              <div className="mt-3">
                <Button
                  variant="secondary"
                  disabled={supervisorScheduling}
                  onClick={() => void handleScheduleSupervisorShift()}
                >
                  {supervisorScheduling ? t("Programando...", "Scheduling...") : t("Programar turno", "Schedule shift")}
                </Button>
              </div>
            </Card>

            <Card title={t("Entrada/salida de supervision", "Supervisor entry/exit")} subtitle={t("Registro obligatorio por restaurante con GPS + evidencia.", "Mandatory record by restaurant with GPS + evidence.")}>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  <select
                    value={presenceRestaurantId ?? ""}
                    onChange={event => setPresenceRestaurantId(Number(event.target.value) || null)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">{t("Seleccionar restaurante", "Select restaurant")}</option>
                    {presenceRestaurants.map(restaurant => (
                      <option key={restaurant.id} value={restaurant.id}>
                        {restaurant.name}
                      </option>
                    ))}
                  </select>

                  {presenceRestaurants.length === 0 && (
                    <p className="text-xs text-amber-700">
                      {t("No hay restaurantes asignados para registrar presencia.", "No assigned restaurants to register presence.")}
                    </p>
                  )}

                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="presence-phase"
                        checked={presencePhase === "start"}
                        onChange={() => setPresencePhase("start")}
                      />
                      {t("Entrada", "Entry")}
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="presence-phase"
                        checked={presencePhase === "end"}
                        onChange={() => setPresencePhase("end")}
                      />
                      {t("Salida", "Exit")}
                    </label>
                  </div>

                  <textarea
                    rows={2}
                    value={presenceNotes}
                    onChange={event => setPresenceNotes(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={t("Notas de presencia (opcional)", "Presence notes (optional)")}
                  />
                </div>

                <div className="space-y-3">
                  <GPSGuard onLocation={setPresenceCoords} />
                  <CameraCapture
                    onCapture={setPresencePhoto}
                    overlayLines={[
                      `${t("Usuario", "User")}: ${currentUserId ?? t("desconocido", "unknown")}`,
                      `${t("Empleado", "Employee")}: ${currentUserId ?? t("desconocido", "unknown")}`,
                      `${t("Restaurante", "Restaurant")}: ${presenceRestaurantId ?? "-"}`,
                      `${t("Turno", "Shift")}: ${t("supervision", "supervision")}-${presencePhase}`,
                      `${t("Fase de supervision", "Supervisor phase")}: ${presencePhase}`,
                      presenceCoords
                        ? `GPS: ${presenceCoords.lat.toFixed(6)}, ${presenceCoords.lng.toFixed(6)}`
                        : t("GPS: pendiente", "GPS: pending"),
                    ]}
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={() => void handleRegisterPresence()} disabled={registeringPresence}>
                  {registeringPresence ? t("Guardando...", "Saving...") : t("Registrar presencia de supervision", "Register supervisor presence")}
                </Button>
                <span className="text-xs text-slate-500">
                  {t("Registros recientes", "Latest records")}: {supervisorPresence.length}
                </span>
              </div>

              {supervisorPresence.length > 0 && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="mb-2 font-medium text-slate-700">{t("Historial reciente de presencia", "Recent presence history")}</p>
                  <ul className="space-y-1 text-slate-600">
                    {supervisorPresence.slice(0, 6).map(item => (
                      <li key={item.id}>
                        {formatDateTime(item.recorded_at)} | {t("Restaurante", "Restaurant")} #{item.restaurant_id} | {t("Fase", "Phase")}: {item.phase}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            <Card title={t("Monitoreo de tareas", "Task monitoring")} subtitle={t("Tareas recientes creadas o asignadas en restaurantes supervisados.", "Recent tasks created or assigned in supervised restaurants.")}>
              {loadingTasks ? (
                <Skeleton className="h-20" />
              ) : supervisorTasks.length === 0 ? (
                <p className="text-sm text-slate-500">{t("Aun no hay tareas operativas registradas.", "There are no operational tasks recorded yet.")}</p>
              ) : (
                <div className="space-y-2">
                  {supervisorTasks.slice(0, 8).map(task => (
                    <div key={task.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <p className="font-medium text-slate-800">
                        #{task.id} {task.title}
                      </p>
                      <p className="text-slate-600">{t("Estado", "Status")}: {task.status} | {t("Prioridad", "Priority")}: {task.priority}</p>
                      <p className="text-xs text-slate-500">
                        {t("Empleado", "Employee")}: {task.assigned_employee_id.slice(0, 8)} | {t("Turno", "Shift")}: {task.shift_id}
                      </p>
                      {task.due_at && (
                        <p className="text-xs text-slate-500">{t("Vence", "Due")}: {formatDateTime(task.due_at)}</p>
                      )}
                      {task.status === "completed" && task.evidence_path && (
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleOpenTaskDetail(task)}
                          >
                            {t("Ver detalle de evidencias", "View evidence details")}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title={t("Control de turnos programados", "Scheduled shift control")} subtitle={t("Cancelar o reprogramar turnos proximos.", "Cancel or reschedule upcoming shifts.")}>
              {supervisionScheduledShifts.length === 0 ? (
                <p className="text-sm text-slate-500">{t("No se encontraron turnos programados.", "No scheduled shifts found.")}</p>
              ) : (
                <div className="space-y-2">
                  {supervisionScheduledShifts.slice(0, 20).map(item => {
                    const editing = editingSupervisionScheduledId === item.id
                    return (
                      <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <p className="font-medium text-slate-800">#{item.id} | {t("Empleado", "Employee")}: {item.employee_id.slice(0, 8)} | {t("Restaurante", "Restaurant")}: {item.restaurant_id}</p>
                        {!editing ? (
                          <>
                            <p className="text-slate-600">
                              {formatDateTime(item.scheduled_start)} - {formatDateTime(item.scheduled_end)}
                            </p>
                            <p className="text-xs text-slate-500">{t("Estado", "Status")}: {item.status}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {item.status !== "cancelled" && (
                                <Button size="sm" variant="ghost" onClick={() => handleStartEditSupervisionScheduled(item)}>
                                  {t("Reprogramar", "Reschedule")}
                                </Button>
                              )}
                              {item.status !== "cancelled" && (
                                <Button size="sm" variant="danger" onClick={() => void handleCancelSupervisionScheduledShift(item)}>
                                  {t("Cancelar", "Cancel")}
                                </Button>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <input
                              type="datetime-local"
                              value={editSupervisionScheduledStart}
                              onChange={event => setEditSupervisionScheduledStart(event.target.value)}
                              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                            />
                            <input
                              type="datetime-local"
                              value={editSupervisionScheduledEnd}
                              onChange={event => setEditSupervisionScheduledEnd(event.target.value)}
                              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                            />
                            <div className="sm:col-span-2 flex flex-wrap gap-2">
                              <Button size="sm" onClick={() => void handleSaveReprogramSupervisionScheduled()}>
                                {t("Guardar", "Save")}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingSupervisionScheduledId(null)
                                  setEditSupervisionScheduledStart("")
                                  setEditSupervisionScheduledEnd("")
                                }}
                              >
                                {t("Cerrar", "Close")}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>

            {loadingSupervisor ? (
              <Skeleton className="h-40" />
            ) : supervisorRows.length === 0 ? (
              <EmptyState
                title={t("Sin turnos activos", "No active shifts")}
                description={t("Cuando haya actividad en curso la veras aqui.", "When there is activity in progress, you will see it here.")}
                actionLabel={t("Actualizar", "Refresh")}
                onAction={() => void loadSupervisorData()}
              />
            ) : (
              <div className="space-y-3">
                {supervisorRows.map(row => {
                  return (
                    <Card
                      key={row.id}
                      title={`${t("Turno", "Shift")} ${String(row.id).slice(0, 8)}`}
                      subtitle={`${t("Inicio", "Start")}: ${formatDateTime(row.start_time)} | ${t("Estado", "Status")}: ${row.status}`}
                    >
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 p-3 text-sm">
                          <p className="font-medium text-slate-700">{t("Evidencia de inicio", "Start evidence")}</p>
                          {row.start_evidence_path ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                void (async () => {
                                  try {
                                    const signedUrl = await resolveEvidenceUrl(row.start_evidence_path)
                                    if (!signedUrl) {
                                      showToast("info", t("No se pudo generar URL de evidencia.", "Could not generate evidence URL."))
                                      return
                                    }
                                    window.open(signedUrl, "_blank", "noopener,noreferrer")
                                  } catch (error: unknown) {
                                    showToast("error", extractErrorMessage(error, t("No se pudo abrir la evidencia.", "Could not open evidence.")))
                                  }
                                })()
                              }}
                            >
                              {t("Ver evidencia de inicio", "View start evidence")}
                            </Button>
                          ) : (
                            <p className="text-slate-500">{t("No hay evidencia registrada.", "No evidence registered.")}</p>
                          )}
                        </div>
                        <div className="rounded-lg border border-slate-200 p-3 text-sm">
                          <p className="font-medium text-slate-700">{t("Evidencia de cierre", "End evidence")}</p>
                          {row.end_evidence_path ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                void (async () => {
                                  try {
                                    const signedUrl = await resolveEvidenceUrl(row.end_evidence_path)
                                    if (!signedUrl) {
                                      showToast("info", t("No se pudo generar URL de evidencia.", "Could not generate evidence URL."))
                                      return
                                    }
                                    window.open(signedUrl, "_blank", "noopener,noreferrer")
                                  } catch (error: unknown) {
                                    showToast("error", extractErrorMessage(error, t("No se pudo abrir la evidencia.", "Could not open evidence.")))
                                  }
                                })()
                              }}
                            >
                              {t("Ver evidencia de cierre", "View end evidence")}
                            </Button>
                          ) : (
                            <p className="text-slate-500">{t("Cierre pendiente.", "Closure pending.")}</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void handleStatusChange(row.id, "approved")}>
                          {t("Aprobar", "Approve")}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => void handleStatusChange(row.id, "rejected")}>
                          {t("Rechazar", "Reject")}
                        </Button>
                      </div>

                      <div className="mt-4 space-y-2 rounded-lg border border-slate-200 p-3">
                        <p className="text-sm font-medium text-slate-700">{t("Crear tarea para este turno", "Create task for this shift")}</p>
                        <input
                          value={newTaskByShift[row.id]?.title ?? ""}
                          onChange={event =>
                            setNewTaskByShift(prev => ({
                              ...prev,
                              [row.id]: {
                                title: event.target.value,
                                description: prev[row.id]?.description ?? "",
                                priority: prev[row.id]?.priority ?? "normal",
                                dueAt: prev[row.id]?.dueAt ?? "",
                              },
                            }))
                          }
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder={t("Titulo de tarea", "Task title")}
                        />
                        <textarea
                          value={newTaskByShift[row.id]?.description ?? ""}
                          onChange={event =>
                            setNewTaskByShift(prev => ({
                              ...prev,
                              [row.id]: {
                                title: prev[row.id]?.title ?? "",
                                description: event.target.value,
                                priority: prev[row.id]?.priority ?? "normal",
                                dueAt: prev[row.id]?.dueAt ?? "",
                              },
                            }))
                          }
                          rows={2}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder={t("Instrucciones. Incluye criterio de cierre: primer plano + plano medio + vista general.", "Instructions. Include closing criteria: close-up + mid-range + wide overview.")}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="datetime-local"
                            value={newTaskByShift[row.id]?.dueAt ?? ""}
                            onChange={event =>
                              setNewTaskByShift(prev => ({
                                ...prev,
                                [row.id]: {
                                  title: prev[row.id]?.title ?? "",
                                  description: prev[row.id]?.description ?? "",
                                  priority: prev[row.id]?.priority ?? "normal",
                                  dueAt: event.target.value,
                                },
                              }))
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                          <select
                            value={newTaskByShift[row.id]?.priority ?? "normal"}
                            onChange={event =>
                              setNewTaskByShift(prev => ({
                                ...prev,
                                [row.id]: {
                                  title: prev[row.id]?.title ?? "",
                                  description: prev[row.id]?.description ?? "",
                                  priority: event.target.value as TaskPriority,
                                  dueAt: prev[row.id]?.dueAt ?? "",
                                },
                              }))
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="low">{t("Baja", "Low")}</option>
                            <option value="normal">{t("Normal", "Normal")}</option>
                            <option value="high">{t("Alta", "High")}</option>
                            <option value="critical">{t("Critica", "Critical")}</option>
                          </select>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => void handleCreateTaskForShift(row)}
                            disabled={creatingTaskForShift === row.id}
                          >
                            {creatingTaskForShift === row.id ? t("Guardando...", "Saving...") : t("Crear tarea", "Create task")}
                          </Button>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2">
                        <label className="text-sm font-medium text-slate-700">{t("Registrar incidente", "Register incident")}</label>
                        <textarea
                          value={incidentNotes[row.id] ?? ""}
                          onFocus={() => void loadIncidentsForShift(row.id)}
                          onChange={event =>
                            setIncidentNotes(prev => ({
                              ...prev,
                              [row.id]: event.target.value,
                            }))
                          }
                          rows={3}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
                          placeholder={t("Describe el incidente observado...", "Describe the observed incident...")}
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void handleCreateIncident(row.id)}
                        >
                          {t("Guardar incidente", "Save incident")}
                        </Button>
                      </div>

                      {(incidentHistory[row.id] ?? []).length > 0 && (
                        <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
                          <p className="mb-2 font-medium text-slate-700">{t("Incidentes recientes", "Recent incidents")}</p>
                          <ul className="space-y-1 text-slate-600">
                            {incidentHistory[row.id].map(incident => (
                              <li key={incident.id}>
                                {formatDateTime(incident.created_at)} - {incident.note}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </Card>
                  )
                })}
              </div>
            )}
          </section>
        )}

        <Modal open={!!taskDetailModalTask} onClose={closeTaskDetailModal}>
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-slate-900">
              {t("Detalle de evidencia de tarea", "Task evidence detail")}{" "}
              {taskDetailModalTask ? `#${taskDetailModalTask.id}` : ""}
            </h3>

            {loadingTaskDetailManifest ? (
              <div className="space-y-2">
                <Skeleton className="h-8" />
                <Skeleton className="h-36" />
              </div>
            ) : taskDetailManifestError ? (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <p>{taskDetailManifestError}</p>
                {taskDetailModalTask?.evidence_path && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void (async () => {
                        try {
                          const signedUrl = await resolveEvidenceUrl(taskDetailModalTask.evidence_path)
                          if (!signedUrl) {
                            showToast("info", t("No se pudo abrir el archivo de evidencia.", "Could not open evidence file."))
                            return
                          }
                          window.open(signedUrl, "_blank", "noopener,noreferrer")
                        } catch (error: unknown) {
                          showToast("error", extractErrorMessage(error, t("No se pudo abrir el archivo de evidencia.", "Could not open evidence file.")))
                        }
                      })()
                    }}
                  >
                    {t("Abrir archivo de evidencia", "Open evidence file")}
                  </Button>
                )}
              </div>
            ) : !taskDetailManifest ? (
              <p className="text-sm text-slate-600">{t("No hay detalle de evidencia disponible.", "No evidence detail available.")}</p>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <p>{t("Capturada", "Captured")}: {formatDateTime(taskDetailManifest.capturedAt)}</p>
                  <p>{t("Usuario", "User")}: {taskDetailManifest.capturedBy ?? "-"}</p>
                  <p>
                    GPS:{" "}
                    {taskDetailManifest.gps
                      ? `${taskDetailManifest.gps.lat.toFixed(6)}, ${taskDetailManifest.gps.lng.toFixed(6)}`
                      : "-"}
                  </p>
                  <p>{t("Evidencias", "Evidences")}: {taskDetailManifest.evidences.length}</p>
                </div>

                <div className="grid gap-3">
                  {taskDetailManifest.evidences.map(item => (
                    <div key={`${item.shot}-${item.path}`} className="rounded-lg border border-slate-200 p-3">
                      <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                      <p className="text-xs text-slate-500">{item.path}</p>
                      {item.signedUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.signedUrl}
                          alt={`${t("Evidencia", "Evidence")} ${item.label}`}
                          className="mt-2 h-48 w-full rounded-lg border border-slate-200 object-cover"
                        />
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">{t("No se pudo resolver la URL para esta evidencia.", "Could not resolve URL for this evidence.")}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (!taskDetailManifest.manifestSignedUrl) {
                        showToast("info", t("No hay URL de manifiesto disponible.", "No manifest URL available."))
                        return
                      }
                      window.open(taskDetailManifest.manifestSignedUrl, "_blank", "noopener,noreferrer")
                    }}
                  >
                    {t("Ver manifiesto JSON", "View JSON manifest")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      </div>
    </ProtectedRoute>
  )
}



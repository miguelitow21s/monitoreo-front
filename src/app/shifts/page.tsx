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
  getOtpPhoneE164Status,
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
  assignScheduledShiftsBulk,
  cancelScheduledShift,
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
  requestTaskEvidenceUpload,
  requestTaskManifestUpload,
  uploadTaskEvidenceViaSignedUrl,
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
import {
  generateScheduleBlocksFromRange,
  getSchedulePresetRange,
  ScheduleQuickPreset,
} from "@/utils/scheduling"

const HISTORY_PAGE_SIZE = 8
const MAX_GPS_ACCURACY_METERS = 80
const TASK_SHOT_ORDER: Record<string, number> = {
  close_up: 1,
  mid_range: 2,
  wide_general: 3,
}

type TaskEvidenceShotKey = "close_up" | "mid_range" | "wide_general"
type ScheduleTaskDraft = {
  id: number
  title: string
  description: string
  priority: TaskPriority
  dueAt: string
}
type ScheduledShiftUiState = "scheduled" | "in_progress" | "ended" | "cancelled" | "other"

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

const SHIFT_START_WINDOW_MINUTES = 30

function findEligibleScheduledShift(scheduledShifts: ScheduledShift[], nowMs = Date.now()) {
  const sorted = [...scheduledShifts].sort(
    (a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()
  )

  return (
    sorted.find(item => {
      const status = (item.status ?? "").toLowerCase()
      if (status === "cancelled" || status === "canceled") return false
      if (status === "completed" || status === "finished" || status === "finalizado") return false

      const startMs = new Date(item.scheduled_start).getTime()
      const endMs = new Date(item.scheduled_end).getTime()
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false

      const windowStart = startMs - SHIFT_START_WINDOW_MINUTES * 60 * 1000
      return nowMs >= windowStart && nowMs <= endMs
    }) ?? null
  )
}

function getCurrentScheduledRestaurantId(scheduledShifts: ScheduledShift[], nowMs = Date.now()) {
  const match = findEligibleScheduledShift(scheduledShifts, nowMs)
  return match?.restaurant_id
}

function getScheduledShiftUiState(shift: ScheduledShift, nowMs: number): ScheduledShiftUiState {
  const rawStatus = (shift.status ?? "").trim().toLowerCase()
  if (rawStatus === "cancelled" || rawStatus === "canceled") return "cancelled"
  if (rawStatus === "completed" || rawStatus === "finished" || rawStatus === "finalizado") return "ended"
  if (rawStatus === "in_progress" || rawStatus === "active" || rawStatus === "activo") return "in_progress"

  const startMs = new Date(shift.scheduled_start).getTime()
  const endMs = new Date(shift.scheduled_end).getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "other"

  if (nowMs < startMs) return "scheduled"
  if (nowMs >= startMs && nowMs <= endMs) return "in_progress"
  if (nowMs > endMs) return "ended"
  return "other"
}

function formatDateOnly(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "-"
  return date.toLocaleDateString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

function formatTimeOnly(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "-"
  return date.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

async function sha256Hex(blob: Blob) {
  const buffer = await blob.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map(item => item.toString(16).padStart(2, "0"))
    .join("")
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function daysFromToday(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateInputValue(date)
}

function formatRestaurantAddress(restaurant: Restaurant | null | undefined) {
  if (!restaurant) return ""
  return [
    restaurant.address_line,
    restaurant.city,
    restaurant.state,
    restaurant.postal_code,
    restaurant.country,
  ]
    .map(item => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .join(", ")
}

function formatRestaurantLabel(restaurant: Restaurant | null | undefined) {
  if (!restaurant) return ""
  const address = formatRestaurantAddress(restaurant)
  return address ? `${restaurant.name} - ${address}` : restaurant.name
}

export default function ShiftsPage() {
  const { loading: roleLoading, isEmpleado, isSupervisora, isSuperAdmin } = useRole()
  const { formatDateTime: formatDateTimeI18n, t } = useI18n()
  const { showToast } = useToast()
  const otpDebugEnabled = process.env.NEXT_PUBLIC_OTP_DEBUG === "true"

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
  const [uploadingStartEvidence, setUploadingStartEvidence] = useState(false)
  const [localStartEvidenceShiftId, setLocalStartEvidenceShiftId] = useState<string | number | null>(null)
  const [startRecoveryPhoto, setStartRecoveryPhoto] = useState<Blob | null>(null)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [verifyingOtp, setVerifyingOtp] = useState(false)
  const [otpCode, setOtpCode] = useState("")
  const [shiftOtpReady, setShiftOtpReady] = useState(false)
  const [otpVerifiedAt, setOtpVerifiedAt] = useState<string | null>(null)
  const [otpPhoneMissingDemo, setOtpPhoneMissingDemo] = useState(false)
  const [otpDebugCode, setOtpDebugCode] = useState<string | null>(null)
  const [otpDebugMaskedPhone, setOtpDebugMaskedPhone] = useState<string | null>(null)
  const [otpDebugExpiresAt, setOtpDebugExpiresAt] = useState<string | null>(null)
  const [clockMs, setClockMs] = useState(() => Date.now())
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
  const [endEarlyReason, setEndEarlyReason] = useState("")
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
  const [taskEvidenceMode, setTaskEvidenceMode] = useState<"manifest" | "image">("manifest")
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
  const [supervisorScheduleNotes, setSupervisorScheduleNotes] = useState("")
  const [supervisorScheduleBlocks, setSupervisorScheduleBlocks] = useState<Array<{ id: number; start: string; end: string }>>([])
  const [supervisorBulkRangeStart, setSupervisorBulkRangeStart] = useState("")
  const [supervisorBulkRangeEnd, setSupervisorBulkRangeEnd] = useState("")
  const [supervisorBulkStartTime, setSupervisorBulkStartTime] = useState("08:00")
  const [supervisorBulkEndTime, setSupervisorBulkEndTime] = useState("16:00")
  const [supervisorBulkWeekdays, setSupervisorBulkWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [supervisorBulkScheduling, setSupervisorBulkScheduling] = useState(false)
  const [supervisorScheduleTaskDrafts, setSupervisorScheduleTaskDrafts] = useState<ScheduleTaskDraft[]>([])

  const healthAnswered = activeShift ? endFitForWork !== null : startFitForWork !== null
  const healthDeclarationRequired =
    activeShift ? endFitForWork === false : startFitForWork === false
  const healthDeclarationProvided = activeShift
    ? endHealthDeclaration.trim().length > 0
    : startHealthDeclaration.trim().length > 0

  const startChecklistComplete = startPpeReady !== null && startNoSymptoms !== null
  const endChecklistComplete = endIncidentsOccurred !== null && endAreaDelivered !== null

  const canOperateEmployee = !roleLoading && isEmpleado
  const canOperateShift = !roleLoading && isEmpleado
  const canOperateSupervisor = !roleLoading && (isSupervisora || isSuperAdmin)
  const canOperateOtp = canOperateShift || canOperateSupervisor
  const weekdayOptions = [
    { value: 1, label: t("Lun", "Mon") },
    { value: 2, label: t("Mar", "Tue") },
    { value: 3, label: t("Mie", "Wed") },
    { value: 4, label: t("Jue", "Thu") },
    { value: 5, label: t("Vie", "Fri") },
    { value: 6, label: t("Sab", "Sat") },
    { value: 0, label: t("Dom", "Sun") },
  ]

  const activeShiftUploadedEvidenceTypes = useMemo(() => {
    const raw = employeeDashboard?.active_shift?.uploaded_evidence_types ?? employeeDashboard?.uploaded_evidence_types
    if (!Array.isArray(raw)) return [] as string[]
    return raw
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  }, [employeeDashboard])

  const localHasStartEvidence = useMemo(() => {
    if (!activeShift?.id || localStartEvidenceShiftId === null) return false
    return String(activeShift.id) === String(localStartEvidenceShiftId)
  }, [activeShift?.id, localStartEvidenceShiftId])
  const hasStartEvidence = activeShiftUploadedEvidenceTypes.includes("inicio") || localHasStartEvidence
  const activeShiftId = useMemo(
    () => activeShift?.id ?? employeeDashboard?.active_shift?.id ?? null,
    [activeShift?.id, employeeDashboard?.active_shift?.id]
  )
  const employeeTasksForShift = useMemo(() => {
    if (!activeShiftId) return [] as OperationalTask[]
    return employeeTasks.filter(task => String(task.shift_id ?? "") === String(activeShiftId))
  }, [activeShiftId, employeeTasks])
  const pendingEmployeeTasks = useMemo(
    () => employeeTasksForShift.filter(task => task.status === "pending" || task.status === "in_progress"),
    [employeeTasksForShift]
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

  useEffect(() => {
    const intervalId = window.setInterval(() => setClockMs(Date.now()), 30000)
    return () => window.clearInterval(intervalId)
  }, [])

  const scheduledShiftsWithUiState = useMemo(
    () =>
      [...scheduledShifts]
        .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime())
        .map(item => ({
          shift: item,
          uiState: getScheduledShiftUiState(item, clockMs),
        })),
    [clockMs, scheduledShifts]
  )

  const scheduledShiftUiStateById = useMemo(
    () => new Map(scheduledShiftsWithUiState.map(item => [item.shift.id, item.uiState])),
    [scheduledShiftsWithUiState]
  )

  const nextScheduledShift = useMemo(
    () =>
      scheduledShiftsWithUiState.find(item => item.uiState === "in_progress" || item.uiState === "scheduled")?.shift ??
      scheduledShiftsWithUiState[0]?.shift ??
      null,
    [scheduledShiftsWithUiState]
  )

  const nextScheduledShiftUiState = useMemo(
    () => (nextScheduledShift ? scheduledShiftUiStateById.get(nextScheduledShift.id) ?? "other" : null),
    [nextScheduledShift, scheduledShiftUiStateById]
  )

  const currentScheduledShift = useMemo(
    () => findEligibleScheduledShift(scheduledShifts, clockMs),
    [clockMs, scheduledShifts]
  )

  const currentScheduledRestaurant = useMemo(() => {
    const currentRestaurantId = currentScheduledShift?.restaurant_id ?? null
    if (!currentRestaurantId) return null
    return knownRestaurants.find(item => Number(item.id) === Number(currentRestaurantId)) ?? null
  }, [currentScheduledShift, knownRestaurants])

  const currentScheduledEndMs = useMemo(() => {
    if (!currentScheduledShift?.scheduled_end) return null
    const endMs = new Date(currentScheduledShift.scheduled_end).getTime()
    return Number.isFinite(endMs) ? endMs : null
  }, [currentScheduledShift])

  const earlyEndReasonRequired = useMemo(() => {
    if (!activeShift || currentScheduledEndMs === null) return false
    return clockMs < currentScheduledEndMs
  }, [activeShift, clockMs, currentScheduledEndMs])

  const canSubmit =
    !!coords &&
    !!photo &&
    !processing &&
    shiftOtpReady &&
    healthAnswered &&
    (!healthDeclarationRequired || healthDeclarationProvided) &&
    (!earlyEndReasonRequired || endEarlyReason.trim().length > 0) &&
    (activeShift ? endChecklistComplete : startChecklistComplete)

  const knownRestaurantsById = useMemo(
    () => new Map(knownRestaurants.map(item => [Number(item.id), item])),
    [knownRestaurants]
  )

  const supervisorScheduleEligibleUsers = useMemo(() => staffUsers, [staffUsers])

  const selectedSupervisorScheduleEmployeeLabel = useMemo(() => {
    const selected = supervisorScheduleEligibleUsers.find(item => item.id === supervisorScheduleEmployeeId)
    return (
      selected?.full_name ??
      selected?.email ??
      selected?.id ??
      t("Sin empleado seleccionado", "No employee selected")
    )
  }, [supervisorScheduleEligibleUsers, supervisorScheduleEmployeeId, t])

  const selectedSupervisorScheduleRestaurantLabel = useMemo(() => {
    if (!supervisorScheduleRestaurantId) {
      return t("Sin restaurante seleccionado", "No restaurant selected")
    }

    const known = knownRestaurantsById.get(supervisorScheduleRestaurantId)
    if (known) {
      return formatRestaurantLabel(known) || known.name || `#${supervisorScheduleRestaurantId}`
    }

    const scoped = staffRestaurants.find(item => item.id === supervisorScheduleRestaurantId)
    return scoped?.name ?? `#${supervisorScheduleRestaurantId}`
  }, [knownRestaurantsById, staffRestaurants, supervisorScheduleRestaurantId, t])

  const getRestaurantLabelById = useCallback(
    (restaurantId: number | null | undefined) => {
      if (!restaurantId) return "-"
      const restaurant = knownRestaurantsById.get(Number(restaurantId))
      if (!restaurant) return `#${restaurantId}`
      return formatRestaurantLabel(restaurant) || restaurant.name || `#${restaurantId}`
    },
    [knownRestaurantsById]
  )

  const getScheduledShiftStatusLabel = useCallback(
    (state: ScheduledShiftUiState) => {
      if (state === "scheduled") return t("Programado", "Scheduled")
      if (state === "in_progress") return t("En curso", "In progress")
      if (state === "ended") return t("Terminado", "Ended")
      if (state === "cancelled") return t("Cancelado", "Cancelled")
      return t("Sin estado", "No status")
    },
    [t]
  )

  const getScheduledShiftStatusClass = useCallback((state: ScheduledShiftUiState) => {
    if (state === "scheduled") return "bg-blue-50 text-blue-700 border-blue-200"
    if (state === "in_progress") return "bg-emerald-50 text-emerald-700 border-emerald-200"
    if (state === "ended") return "bg-slate-100 text-slate-700 border-slate-200"
    if (state === "cancelled") return "bg-rose-50 text-rose-700 border-rose-200"
    return "bg-slate-50 text-slate-600 border-slate-200"
  }, [])

  const expectedRestaurantId = useMemo(() => {
    if (currentScheduledRestaurant?.id) return Number(currentScheduledRestaurant.id)
    if (nextScheduledShift?.restaurant_id) return Number(nextScheduledShift.restaurant_id)
    if (isSupervisora && presenceRestaurantId) return presenceRestaurantId
    if (isSupervisora && supervisorShiftRestaurantId) return supervisorShiftRestaurantId
    return null
  }, [
    currentScheduledRestaurant,
    isSupervisora,
    nextScheduledShift,
    presenceRestaurantId,
    supervisorShiftRestaurantId,
  ])

  const geofenceTarget = useMemo(() => {
    if (isSupervisora) {
      if (!expectedRestaurantId) return null
      return knownRestaurantsById.get(Number(expectedRestaurantId)) ?? null
    }
    return currentScheduledRestaurant
  }, [currentScheduledRestaurant, expectedRestaurantId, isSupervisora, knownRestaurantsById])

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

  const selectedTask = useMemo(
    () => employeeTasksForShift.find(task => task.id === selectedTaskId) ?? null,
    [employeeTasksForShift, selectedTaskId]
  )

  const submitBlockers = useMemo(() => {
    const blockers: string[] = []
    if (!coords) blockers.push(t("Debes capturar la ubicacion GPS.", "You must capture GPS location."))
    if (coords?.isMocked) blockers.push(t("Se detecto una fuente GPS sospechosa. Desactiva ubicacion simulada antes de registrar.", "Suspicious GPS source detected. Disable simulated location before registering."))
    if (isSupervisora && !expectedRestaurantId) {
      blockers.push(
        t(
          "No se encontro restaurante programado para tu turno. Valida la asignacion en programacion.",
          "No scheduled restaurant was found for your shift. Check schedule assignment."
        )
      )
    }
    if (!activeShift && !currentScheduledShift) {
      blockers.push(
        t(
          `No hay turno programado dentro de la ventana permitida (30 min antes del inicio hasta el fin).`,
          "No scheduled shift is within the allowed window (30 min before start through end time)."
        )
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
    if (activeShift && earlyEndReasonRequired && endEarlyReason.trim().length === 0) {
      blockers.push(
        t(
          "Debes indicar la razon de salida temprana.",
          "You must provide a reason for early shift end."
        )
      )
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
    currentScheduledShift,
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
    earlyEndReasonRequired,
    endEarlyReason,
    geofenceValidation,
    isSupervisora,
    expectedRestaurantId,
    t,
  ])

  const shiftEvidencePhase = activeShift
    ? hasStartEvidence
      ? t("fin-turno", "shift-end")
      : t("inicio-turno", "shift-start")
    : t("inicio-turno", "shift-start")

  const shiftOverlayLines = [
    `${t("Usuario", "User")}: ${currentUserId ?? t("desconocido", "unknown")}`,
    `${t("Empleado", "Employee")}: ${currentUserId ?? t("desconocido", "unknown")}`,
    `${t("Restaurante", "Restaurant")}: ${getRestaurantLabelById(expectedRestaurantId)}`,
    `${t("Turno", "Shift")}: ${activeShift ? `#${activeShift.id}` : t("inicio", "start")}`,
    `${t("Fase", "Phase")}: ${shiftEvidencePhase}`,
    coords ? `GPS: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : t("GPS: pendiente", "GPS: pending"),
  ]

  const loadEmployeeData = useCallback(async (page: number) => {
    setLoadingData(true)
    try {
      const [active, historyResult] = await Promise.all([
        getMyActiveShift(),
        getMyShiftHistory(page, HISTORY_PAGE_SIZE),
      ])
      setActiveShift(active)
      setHistory(historyResult.rows)
      setHistoryTotalPages(historyResult.totalPages)
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
      const restaurantId = isSupervisora ? supervisorScheduleRestaurantId ?? null : null
      if (isSupervisora && !restaurantId) {
        setSupervisionScheduledShifts([])
        return
      }
      const rows = await listScheduledShifts(120, restaurantId)
      setSupervisionScheduledShifts(rows)
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudieron cargar los turnos programados.", "Could not load scheduled shifts.")))
    }
  }, [
    canOperateSupervisor,
    isSupervisora,
    showToast,
    supervisorScheduleRestaurantId,
    t,
  ])

  const loadKnownRestaurants = useCallback(async () => {
    try {
      const rows = await listRestaurants({ includeInactive: false, ...(isSuperAdmin ? { useAdminApi: true } : {}) })
      setKnownRestaurants(rows)
    } catch {
      // Best effort: backend remains source of truth for geofence validation.
    }
  }, [isSuperAdmin])

  const loadPresenceRestaurants = useCallback(async () => {
    if (!canOperateSupervisor) return
    try {
      const items = isSuperAdmin
        ? (await listRestaurants({ useAdminApi: true }))
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
    if (roleLoading) return
    if (!canOperateShift) return
    void loadEmployeeData(historyPage)
  }, [historyPage, canOperateShift, loadEmployeeData, roleLoading])

  useEffect(() => {
    if (!activeShift) {
      setLocalStartEvidenceShiftId(null)
    }
  }, [activeShift])

  useEffect(() => {
    if (roleLoading) return
    if (!canOperateOtp) return
    getOrCreateDeviceFingerprint()
    setShiftOtpReady(Boolean(getShiftOtpToken()))
  }, [canOperateOtp, roleLoading])

  useEffect(() => {
    if (!otpDebugEnabled) {
      setOtpPhoneMissingDemo(false)
      return
    }
    if (roleLoading || !canOperateOtp) return
    let mounted = true
    const checkPhone = async () => {
      try {
        const status = await getOtpPhoneE164Status()
        if (!mounted) return
        setOtpPhoneMissingDemo(!status.isValid)
      } catch {
        if (!mounted) return
        setOtpPhoneMissingDemo(true)
      }
    }
    void checkPhone()
    return () => {
      mounted = false
    }
  }, [canOperateOtp, otpDebugEnabled, roleLoading])

  useEffect(() => {
    if (roleLoading) return
    if (!canOperateSupervisor) return
    void loadSupervisorData()
  }, [canOperateSupervisor, loadSupervisorData, roleLoading])

  useEffect(() => {
    if (roleLoading) return
    if (!canOperateSupervisor) return
    void loadSupervisionScheduledShifts()
  }, [canOperateSupervisor, loadSupervisionScheduledShifts, roleLoading])

  useEffect(() => {
    if (roleLoading) return
    if (!canOperateSupervisor) return
    void loadPresenceRestaurants()
  }, [canOperateSupervisor, loadPresenceRestaurants, roleLoading])

  useEffect(() => {
    if (!isSupervisora) return
    const autoRestaurantId =
      Number(currentScheduledRestaurant?.id ?? nextScheduledShift?.restaurant_id ?? presenceRestaurants[0]?.id ?? 0) || null
    if (!autoRestaurantId) return
    setSupervisorShiftRestaurantId(prev => (prev === autoRestaurantId ? prev : autoRestaurantId))
  }, [currentScheduledRestaurant?.id, isSupervisora, nextScheduledShift?.restaurant_id, presenceRestaurants])

  useEffect(() => {
    if (!supervisorBulkRangeStart) setSupervisorBulkRangeStart(daysFromToday(0))
    if (!supervisorBulkRangeEnd) setSupervisorBulkRangeEnd(daysFromToday(30))
  }, [supervisorBulkRangeStart, supervisorBulkRangeEnd])

  useEffect(() => {
    if (roleLoading) return
    void loadKnownRestaurants()
  }, [loadKnownRestaurants, roleLoading])

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
    if (roleLoading) return
    setLoadingTasks(true)
    try {
      if (canOperateEmployee) {
        const items = await listMyOperationalTasks(40)
        setEmployeeTasks(items)
      }
      if (canOperateSupervisor) {
        const restaurantId = staffRestaurantId ?? presenceRestaurantId ?? null
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
  }, [canOperateEmployee, canOperateSupervisor, presenceRestaurantId, roleLoading, showToast, staffRestaurantId, t])

  const loadEmployeeSelfServiceDashboard = useCallback(async () => {
    if (roleLoading) return
    if (!canOperateEmployee) return
    try {
      const payload = await getEmployeeSelfDashboard()
      setEmployeeDashboard(payload)
      const normalizedScheduled = (payload.scheduled_shifts ?? [])
        .map((item): ScheduledShift | null => {
          const id = Number(item.id)
          const restaurantId = Number(item.restaurant_id)
          if (!Number.isFinite(id) || !Number.isFinite(restaurantId)) return null
          if (!item.scheduled_start || !item.scheduled_end) return null
          return {
            id,
            employee_id: currentUserId ?? "",
            restaurant_id: restaurantId,
            scheduled_start: item.scheduled_start,
            scheduled_end: item.scheduled_end,
            status: item.status ?? "scheduled",
            notes: null,
          }
        })
        .filter((item): item is ScheduledShift => item !== null)
      setScheduledShifts(normalizedScheduled)
    } catch {
      // Keep UX resilient while backend rollout converges.
    }
  }, [canOperateEmployee, currentUserId, roleLoading])

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
        listUserProfiles(isSuperAdmin ? { useAdminApi: true } : undefined),
        isSuperAdmin
          ? (async () => {
              const rows = await listRestaurants({ includeInactive: false, useAdminApi: true })
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
    if (roleLoading) return
    void loadTasks()
  }, [loadTasks, roleLoading])

  useEffect(() => {
    if (!selectedTaskId) return
    if (!employeeTasksForShift.some(task => task.id === selectedTaskId)) {
      setSelectedTaskId(null)
      setTaskCoords(null)
      setTaskPhotoClose(null)
      setTaskPhotoMid(null)
      setTaskPhotoWide(null)
    }
  }, [employeeTasksForShift, selectedTaskId])

  useEffect(() => {
    if (roleLoading) return
    void loadPresenceLogs()
  }, [loadPresenceLogs, roleLoading])

  useEffect(() => {
    if (roleLoading) return
    void loadStaffAssignmentContext()
  }, [loadStaffAssignmentContext, roleLoading])

  useEffect(() => {
    if (roleLoading) return
    void loadStaffAssignments()
  }, [loadStaffAssignments, roleLoading])

  useEffect(() => {
    if (!supervisorScheduleRestaurantId) {
      setSupervisorScheduleEmployeeId("")
      return
    }
    if (supervisorScheduleEligibleUsers.length === 0) {
      setSupervisorScheduleEmployeeId("")
      return
    }
    setSupervisorScheduleEmployeeId(prev =>
      prev && supervisorScheduleEligibleUsers.some(item => item.id === prev)
        ? prev
        : supervisorScheduleEligibleUsers[0]?.id ?? ""
    )
  }, [supervisorScheduleEligibleUsers, supervisorScheduleRestaurantId])

  useEffect(() => {
    if (roleLoading) return
    void loadEmployeeSelfServiceDashboard()
  }, [loadEmployeeSelfServiceDashboard, roleLoading])

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
    setStartRecoveryPhoto(null)
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
      const result = await sendShiftPhoneOtp()
      const maskedPhone = result?.maskedPhone
      const deliveryStatus = result?.deliveryStatus
      const debugCode = otpDebugEnabled ? result?.debugCode : null
      if (otpDebugEnabled) {
        setOtpDebugCode(debugCode ?? null)
        setOtpDebugMaskedPhone(maskedPhone ?? null)
        setOtpDebugExpiresAt(result?.expiresAt ?? null)
      }
      if (otpDebugEnabled && result?.phoneMissing) {
        setOtpPhoneMissingDemo(true)
      }
      const debugSuffix =
        deliveryStatus === "debug"
          ? t(" (modo debug: SMS no enviado)", " (debug mode: SMS not sent)")
          : ""
      const phoneLabel = maskedPhone ? ` ${maskedPhone}` : ""
      const debugCodeLabel = debugCode
        ? t(` Codigo demo: ${debugCode}`, ` Demo code: ${debugCode}`)
        : ""
      showToast(
        "success",
        maskedPhone
          ? t(
              `Codigo OTP enviado a${phoneLabel}.${debugSuffix}${debugCodeLabel}`,
              `OTP sent to${phoneLabel}.${debugSuffix}${debugCodeLabel}`
            )
          : t(
              `Codigo OTP enviado. Revisa tu telefono.${debugSuffix}${debugCodeLabel}`,
              `OTP code sent. Check your phone.${debugSuffix}${debugCodeLabel}`
            )
      )
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
      const scheduledShift = currentScheduledShift
      const currentRestaurantId = overrideRestaurantId ?? scheduledShift?.restaurant_id ?? null
      if (!currentRestaurantId) {
        throw new Error(
          t(
            "No hay turno programado disponible en la ventana de inicio (30 min antes hasta el fin).",
            "No scheduled shift is available within the start window (30 min before until end)."
          )
        )
      }
      if (isSupervisora && !scheduledShift && !overrideRestaurantId) {
        throw new Error(t("Selecciona un restaurante programado para iniciar tu turno.", "Select a scheduled restaurant to start your shift."))
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
      setLocalStartEvidenceShiftId(shiftId)

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
      await loadEmployeeData(1)
      await loadEmployeeSelfServiceDashboard()
      await loadTasks()
      await loadSupervisorData()
    } catch (error: unknown) {
      if (startedShiftId) {
        await loadEmployeeData(1)
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

      const earlyReason = endEarlyReason.trim()
      if (earlyEndReasonRequired && !earlyReason) {
        throw new Error(
          t(
            "Debes indicar la razon de salida temprana.",
            "You must provide a reason for early shift end."
          )
        )
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
        earlyEndReason: earlyReason || null,
      })

      if (endObservation.trim()) {
        await createShiftIncident(activeShift.id, `[SALIDA] ${endObservation.trim()}`)
      }

      showToast("success", t("Turno finalizado correctamente.", "Shift ended successfully."))
      resetEvidenceAndLocation()
      setLocalStartEvidenceShiftId(null)
      setEndObservation("")
      setEndFitForWork(null)
      setEndIncidentsOccurred(null)
      setEndAreaDelivered(null)
      setEndHealthDeclaration("")
      setEndEarlyReason("")
      setHistoryPage(1)
      await loadEmployeeData(1)
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

  const handleUploadMissingStartEvidence = async () => {
    if (!activeShift) return
    if (!coords || !startRecoveryPhoto) {
      showToast(
        "info",
        t("Debes capturar GPS y evidencia fotografica de inicio.", "You must capture GPS and start photo evidence.")
      )
      return
    }
    if (!getShiftOtpToken()) {
      setShiftOtpReady(false)
      showToast(
        "info",
        t(
          "OTP vencido o ausente. Verifica OTP para subir evidencia.",
          "OTP missing or expired. Verify OTP before uploading evidence."
        )
      )
      return
    }
    if (!shiftOtpReady) {
      showToast(
        "info",
        t("Debes validar OTP antes de subir evidencia de inicio.", "You must verify OTP before uploading start evidence.")
      )
      return
    }

    setUploadingStartEvidence(true)
    try {
      await uploadShiftEvidence({
        shiftId: Number(activeShift.id),
        type: "inicio",
        file: startRecoveryPhoto,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracyMeters,
      })
      setLocalStartEvidenceShiftId(activeShift.id)
      setStartRecoveryPhoto(null)
      showToast("success", t("Evidencia de inicio cargada.", "Start evidence uploaded."))
      resetEvidenceAndLocation()
      setHistoryPage(1)
      await loadEmployeeData(1)
      await loadEmployeeSelfServiceDashboard()
    } catch (error: unknown) {
      const message = extractErrorMessage(error, "")
      if (message.toLowerCase().includes("otp")) {
        setShiftOtpReady(false)
        showToast(
          "error",
          t(
            "OTP invalido o vencido. Verificalo de nuevo para subir la evidencia.",
            "Invalid or expired OTP. Verify again to upload evidence."
          )
        )
      } else {
        showToast("error", extractErrorMessage(error, t("No se pudo subir la evidencia de inicio.", "Could not upload start evidence.")))
      }
    } finally {
      setUploadingStartEvidence(false)
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
    if (!taskCoords) {
      showToast("info", t("Completar una tarea requiere GPS.", "Completing a task requires GPS."))
      return
    }
    if (taskEvidenceMode === "manifest") {
      if (!taskPhotoClose || !taskPhotoMid || !taskPhotoWide) {
        showToast(
          "info",
          t(
            "Completar una tarea requiere 3 evidencias: primer plano, plano medio y vista general.",
            "Completing a task requires 3 evidences: close-up, mid-range, and wide overview."
          )
        )
        return
      }
    } else if (!taskPhotoClose) {
      showToast("info", t("Debes capturar al menos una evidencia fotografica.", "You must capture at least one photo evidence."))
      return
    }

    setProcessingTask(true)
    try {
      let evidencePath = ""

      if (taskEvidenceMode === "image") {
        const file = taskPhotoClose as Blob
        const mimeType = file.type || "image/jpeg"
        const uploadRequest = await requestTaskEvidenceUpload(selectedTaskId, mimeType)

        if (uploadRequest.token && uploadRequest.bucket) {
          await uploadTaskManifestViaSignedToken({
            bucket: uploadRequest.bucket,
            path: uploadRequest.path,
            token: uploadRequest.token,
            file,
          })
        } else if (uploadRequest.uploadUrl) {
          await uploadTaskEvidenceViaSignedUrl({
            uploadUrl: uploadRequest.uploadUrl,
            file,
            headers: uploadRequest.headers,
          })
        } else {
          throw new Error("No upload URL/token was provided for evidence upload.")
        }

        evidencePath = uploadRequest.path
      } else {
        const [closeEvidence, midEvidence, wideEvidence] = await Promise.all([
          uploadEvidence("task-close", taskPhotoClose as Blob, taskCoords),
          uploadEvidence("task-mid", taskPhotoMid as Blob, taskCoords),
          uploadEvidence("task-wide", taskPhotoWide as Blob, taskCoords),
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

        evidencePath = manifestUpload.path
      }

      await completeOperationalTask({
        taskId: selectedTaskId,
        evidencePath,
        evidenceHash: "",
        evidenceMimeType: taskEvidenceMode === "image" ? (taskPhotoClose?.type || "image/jpeg") : "application/json",
        evidenceSizeBytes: taskEvidenceMode === "image" ? (taskPhotoClose?.size ?? 0) : 0,
      })
      resetTaskEvidenceCapture()
      setSelectedTaskId(null)
      showToast(
        "success",
        taskEvidenceMode === "image"
          ? t("Tarea completada con evidencia fotografica.", "Task completed with photo evidence.")
          : t("Tarea completada con evidencia triple.", "Task completed with triple evidence.")
      )
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

  const handleToggleSupervisorBulkWeekday = (day: number) => {
    setSupervisorBulkWeekdays(prev => {
      if (prev.includes(day)) return prev.filter(item => item !== day)
      return [...prev, day].sort((a, b) => a - b)
    })
  }

  const appendSupervisorGeneratedScheduleBlocks = (generated: Array<{ startLocal: string; endLocal: string }>) => {
    if (generated.length === 0) {
      showToast("info", t("No se pudieron generar bloques con esos criterios.", "Could not generate schedule blocks with those criteria."))
      return
    }

    let addedCount = 0
    setSupervisorScheduleBlocks(prev => {
      const seen = new Set(prev.map(item => `${item.start}|${item.end}`))
      const next = [...prev]

      for (const item of generated) {
        const key = `${item.startLocal}|${item.endLocal}`
        if (seen.has(key)) continue
        seen.add(key)
        next.push({
          id: Date.now() + next.length + Math.floor(Math.random() * 1000),
          start: item.startLocal,
          end: item.endLocal,
        })
        addedCount += 1
      }
      return next
    })

    if (addedCount === 0) {
      showToast("info", t("Los bloques ya existian en la lista.", "Those blocks already exist in the list."))
      return
    }

    showToast("success", t(`${addedCount} bloque(s) agregados.`, `${addedCount} block(s) added.`))
  }

  const handleGenerateSupervisorScheduleBlocks = () => {
    const generated = generateScheduleBlocksFromRange({
      startDate: supervisorBulkRangeStart,
      endDate: supervisorBulkRangeEnd,
      startTime: supervisorBulkStartTime,
      endTime: supervisorBulkEndTime,
      weekdays: supervisorBulkWeekdays,
      maxEntries: 200,
    })

    appendSupervisorGeneratedScheduleBlocks(generated)
  }

  const handleApplySupervisorBulkPreset = (preset: ScheduleQuickPreset) => {
    const range = getSchedulePresetRange(preset)
    setSupervisorBulkRangeStart(range.startDate)
    setSupervisorBulkRangeEnd(range.endDate)
    setSupervisorBulkWeekdays(range.weekdays)

    const generated = generateScheduleBlocksFromRange({
      startDate: range.startDate,
      endDate: range.endDate,
      startTime: supervisorBulkStartTime,
      endTime: supervisorBulkEndTime,
      weekdays: range.weekdays,
      maxEntries: 200,
    })

    appendSupervisorGeneratedScheduleBlocks(generated)
  }

  const handleRemoveSupervisorScheduleBlock = (blockId: number) => {
    setSupervisorScheduleBlocks(prev => prev.filter(item => item.id !== blockId))
  }

  const handleClearSupervisorScheduleBlocks = () => {
    setSupervisorScheduleBlocks([])
  }

  const handleAddSupervisorScheduleTaskDraft = () => {
    setSupervisorScheduleTaskDrafts(prev => [
      ...prev,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        title: "",
        description: "",
        priority: "normal",
        dueAt: "",
      },
    ])
  }

  const handleRemoveSupervisorScheduleTaskDraft = (draftId: number) => {
    setSupervisorScheduleTaskDrafts(prev => prev.filter(item => item.id !== draftId))
  }

  const handleUpdateSupervisorScheduleTaskDraft = (
    draftId: number,
    changes: Partial<Omit<ScheduleTaskDraft, "id">>
  ) => {
    setSupervisorScheduleTaskDrafts(prev =>
      prev.map(item => (item.id === draftId ? { ...item, ...changes } : item))
    )
  }

  const handleScheduleSupervisorShiftBulk = async () => {
    if (!supervisorScheduleEmployeeId || !supervisorScheduleRestaurantId) {
      showToast("info", t("Selecciona empleado y restaurante.", "Select employee and restaurant."))
      return
    }
    const validBlocks = supervisorScheduleBlocks
      .map(item => ({
        startIso: item.start ? new Date(item.start).toISOString() : "",
        endIso: item.end ? new Date(item.end).toISOString() : "",
      }))
      .filter(item => item.startIso && item.endIso)

    if (validBlocks.length === 0) {
      showToast("info", t("Agrega al menos un bloque valido para programar lote.", "Add at least one valid block to schedule bulk."))
      return
    }
    if (validBlocks.length > 200) {
      showToast("info", t("El lote permite maximo 200 turnos por envio.", "Bulk scheduling allows a maximum of 200 shifts per request."))
      return
    }

    const hasInvalidRange = validBlocks.some(item => new Date(item.endIso).getTime() <= new Date(item.startIso).getTime())
    if (hasInvalidRange) {
      showToast("info", t("Todos los bloques deben tener fin posterior al inicio.", "All blocks must have end time after start time."))
      return
    }

    const optionalTaskDrafts = supervisorScheduleTaskDrafts
      .map(item => ({
        ...item,
        title: item.title.trim(),
        description: item.description.trim(),
      }))
      .filter(item => item.title || item.description)

    const hasInvalidOptionalTask = optionalTaskDrafts.some(item => !item.title || !item.description)
    if (hasInvalidOptionalTask) {
      showToast(
        "info",
        t(
          "Cada tarea opcional debe tener titulo y descripcion, o quedar totalmente vacia.",
          "Each optional task must include title and description, or remain fully empty."
        )
      )
      return
    }

    setSupervisorBulkScheduling(true)
    try {
      await assignScheduledShiftsBulk({
        employeeId: supervisorScheduleEmployeeId,
        restaurantId: String(supervisorScheduleRestaurantId),
        blocks: validBlocks.map(item => ({ scheduledStartIso: item.startIso, scheduledEndIso: item.endIso })),
        notes: supervisorScheduleNotes.trim() || undefined,
      })
      showToast("success", t("Turnos en lote programados correctamente.", "Bulk shifts scheduled successfully."))

      if (optionalTaskDrafts.length > 0) {
        const activeRow = supervisorRows.find(
          row =>
            row.employee_id === supervisorScheduleEmployeeId &&
            Number(row.restaurant_id) === Number(supervisorScheduleRestaurantId)
        )

        if (!activeRow) {
          showToast(
            "info",
            t(
              "No se crearon tareas aun porque el empleado no tiene turno activo en este momento. Puedes crearlas cuando inicie su turno.",
              "Optional tasks were not created yet because the employee has no active shift right now. You can create them once the shift starts."
            )
          )
        } else {
          let createdTasks = 0
          let failedTasks = 0
          for (const draft of optionalTaskDrafts) {
            try {
              await createOperationalTask({
                shiftId: Number(activeRow.id),
                restaurantId: Number(supervisorScheduleRestaurantId),
                assignedEmployeeId: supervisorScheduleEmployeeId,
                title: draft.title,
                description: draft.description,
                priority: draft.priority,
                dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
              })
              createdTasks += 1
            } catch {
              failedTasks += 1
            }
          }
          if (createdTasks > 0) {
            showToast(
              "success",
              t(
                `${createdTasks} tarea(s) opcional(es) creadas para el turno activo.`,
                `${createdTasks} optional task(s) created for the active shift.`
              )
            )
            await loadTasks()
          }
          if (failedTasks > 0) {
            showToast(
              "info",
              t(
                `${failedTasks} tarea(s) opcional(es) no se pudieron crear automaticamente.`,
                `${failedTasks} optional task(s) could not be created automatically.`
              )
            )
          }
        }
      }

      setSupervisorScheduleBlocks([])
      setSupervisorScheduleTaskDrafts([])
      await loadSupervisionScheduledShifts()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudieron programar turnos en lote.", "Could not schedule bulk shifts.")))
    } finally {
      setSupervisorBulkScheduling(false)
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
        {canOperateShift && (
          <section className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">
              {t("Operacion de empleado", "Employee operations")}
            </h2>

            {isEmpleado && (
              <>
                <Card title={t("Mi panel", "My dashboard")}>
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
                  <p className="text-xs text-slate-500">{t("Turno en curso", "Shift in progress")}</p>
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
                    {t("Turno en curso desde", "Shift in progress since")} <b>{formatDateTime(activeShift.start_time)}</b>
                  </span>
                  <Badge variant="success">{t("En curso", "In progress")}</Badge>
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

            {activeShift && pendingEmployeeTasks.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">
                  {t("Alerta operativa: tienes", "Operational alert: you have")} {pendingEmployeeTasks.length} {t("tarea(s) asignadas por supervision.", "task(s) assigned by supervisor.")}
                </p>
                <p className="mt-1 text-amber-800">
                  {t(
                    "Cierra cada tarea con la evidencia requerida.",
                    "Close each task with the required evidence."
                  )}
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
              <Card title={t("Restaurante y horario asignados", "Assigned restaurant and schedule")}>
                {nextScheduledShift ? (
                  <div className="space-y-2 text-sm text-slate-700">
                    <p>
                      <span className="font-semibold">{t("Restaurante:", "Restaurant:")}</span> {getRestaurantLabelById(nextScheduledShift.restaurant_id)}
                    </p>
                    <p>
                      <span className="font-semibold">{t("Inicio:", "Start:")}</span> {formatDateTime(nextScheduledShift.scheduled_start)}
                    </p>
                    <p>
                      <span className="font-semibold">{t("Fin:", "End:")}</span> {formatDateTime(nextScheduledShift.scheduled_end)}
                    </p>
                    <p>
                      <span className="font-semibold">{t("Estado:", "Status:")}</span>{" "}
                      {getScheduledShiftStatusLabel(nextScheduledShiftUiState ?? "other")}
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

            <Card
              title={t("Accion principal", "Main action")}
              subtitle={activeShift ? t("Finalizar turno activo", "End active shift") : t("Iniciar nuevo turno", "Start new shift")}
            >
              {(!activeShift || !shiftOtpReady) && (
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
                    {activeShift
                      ? t(
                          "Completa OTP para finalizar turno en este dispositivo.",
                          "Complete OTP to end shift on this device."
                        )
                      : t(
                          "Debes completar OTP de telefono para iniciar turno en este dispositivo.",
                          "Phone OTP must be completed to start shift on this device."
                        )}
                  </p>
                  {otpDebugEnabled && otpPhoneMissingDemo && (
                    <p className="mt-2 text-xs text-amber-700">
                      {t(
                        "Telefono no configurado (demo).",
                        "Phone not configured (demo)."
                      )}
                    </p>
                  )}
                  {otpDebugEnabled && otpDebugCode && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{t("Codigo OTP (demo)", "OTP code (demo)")}</span>
                        <span className="rounded bg-white px-2 py-1 font-mono text-sm text-amber-900">
                          {otpDebugCode}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                              void navigator.clipboard.writeText(otpDebugCode)
                            }
                            showToast("success", t("Codigo copiado.", "Code copied."))
                          }}
                        >
                          {t("Copiar", "Copy")}
                        </Button>
                      </div>
                      <div className="mt-1 text-[11px] text-amber-800">
                        {otpDebugMaskedPhone ? `${t("Enviado a", "Sent to")}: ${otpDebugMaskedPhone}. ` : ""}
                        {otpDebugExpiresAt
                          ? `${t("Expira", "Expires")}: ${formatDateTime(otpDebugExpiresAt)}`
                          : ""}
                      </div>
                    </div>
                  )}

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
              )}

              {!activeShift ? (
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-semibold text-slate-800">
                    {t("Requisitos de inicio", "Start requirements")}
                  </p>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-700">{t("Ubicacion de inicio", "Start location")}</p>
                      <div className="mt-2">
                        <GPSGuard onLocation={setCoords} />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700">{t("Evidencia fotografica de inicio", "Start photo evidence")}</p>
                      <div className="mt-2">
                        <CameraCapture onCapture={setPhoto} overlayLines={shiftOverlayLines} />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-semibold text-slate-800">
                    {t("Requisitos para finalizar", "End requirements")}
                  </p>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-700">{t("Ubicacion de salida", "End location")}</p>
                      <div className="mt-2">
                        <GPSGuard onLocation={setCoords} />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700">{t("Evidencia fotografica de salida", "End photo evidence")}</p>
                      <div className="mt-2">
                        <CameraCapture onCapture={setPhoto} overlayLines={shiftOverlayLines} />
                      </div>
                    </div>
                  </div>

                  {!hasStartEvidence && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <p className="font-semibold">
                        {t("Evidencia de inicio pendiente", "Start evidence pending")}
                      </p>
                      <p className="mt-1 text-xs text-amber-800">
                        {t(
                          "Sube la foto de inicio faltante. Luego toma la foto de salida.",
                          "Upload the missing start photo. Then take the end photo."
                        )}
                      </p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold text-amber-800">{t("Foto de inicio", "Start photo")}</p>
                          <div className="mt-2">
                            <CameraCapture onCapture={setStartRecoveryPhoto} overlayLines={shiftOverlayLines} />
                          </div>
                        </div>
                        <div className="flex flex-col justify-between gap-2">
                          <div className="text-xs text-amber-800">
                            {t("Foto de inicio", "Start photo")}: {startRecoveryPhoto ? t("Lista", "Ready") : t("Pendiente", "Pending")}
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleUploadMissingStartEvidence()}
                            disabled={uploadingStartEvidence || !coords || !startRecoveryPhoto}
                          >
                            {uploadingStartEvidence ? t("Subiendo...", "Uploading...") : t("Subir evidencia de inicio", "Upload start evidence")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
                    <span>{t("GPS", "GPS")}: {coords ? t("Listo", "Ready") : t("Pendiente", "Pending")}</span>
                    <span>{t("Foto de salida", "End photo")}: {photo ? t("Lista", "Ready") : t("Pendiente", "Pending")}</span>
                    <span>{t("Evidencia inicio", "Start evidence")}: {hasStartEvidence ? "OK" : t("Pendiente", "Pending")}</span>
                  </div>
                </div>
              )}

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

              {activeShift && earlyEndReasonRequired && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                  <p className="font-medium text-amber-900">
                    {t("Motivo de salida temprana (obligatorio)", "Early end reason (required)")}
                  </p>
                  <textarea
                    rows={2}
                    value={endEarlyReason}
                    onChange={event => setEndEarlyReason(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
                    placeholder={t("Ej: Termine tareas antes de la hora.", "Example: Finished tasks before scheduled end.")}
                  />
                </div>
              )}

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
                    onClick={() => void handleStart(isSupervisora ? expectedRestaurantId : undefined)}
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
              <Card title={t("Registrar incidente", "Register incident")}>
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
              <Card title={t("Tareas asignadas", "Assigned tasks")}>
              {loadingTasks ? (
                <Skeleton className="h-24" />
              ) : employeeTasksForShift.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {activeShift
                    ? t(
                        "No hay tareas asignadas para este turno.",
                        "There are no assigned tasks for this shift."
                      )
                    : t(
                        "Inicia turno para ver las tareas asignadas.",
                        "Start your shift to view assigned tasks."
                      )}
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {employeeTasksForShift.map(task => (
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
                        {taskEvidenceMode === "image"
                          ? t("Requerido: GPS + 1 foto.", "Required: GPS + 1 photo.")
                          : t("Requerido: GPS + 3 fotos (primer plano, plano medio, vista general).", "Required: GPS + 3 photos (close-up, mid-range, wide overview).")}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="task-evidence-mode"
                            checked={taskEvidenceMode === "manifest"}
                            onChange={() => setTaskEvidenceMode("manifest")}
                          />
                          {t("Evidencia triple (manifest JSON)", "Triple evidence (JSON manifest)")}
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="task-evidence-mode"
                            checked={taskEvidenceMode === "image"}
                            onChange={() => setTaskEvidenceMode("image")}
                          />
                          {t("Evidencia por imagen unica", "Single image evidence")}
                        </label>
                      </div>

                      <div className="mt-3">
                        <GPSGuard onLocation={setTaskCoords} />
                      </div>

                      <div className={`mt-3 grid gap-3 ${taskEvidenceMode === "image" ? "xl:grid-cols-1" : "xl:grid-cols-3"}`}>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-700">{t("Primer plano", "Close-up")}</p>
                          <p className="mb-2 text-xs text-slate-500">{t("Captura un detalle directo del area intervenida.", "Capture a direct detail of the intervened area.")}</p>
                          <CameraCapture
                            onCapture={setTaskPhotoClose}
                            overlayLines={[
                              `${t("Usuario", "User")}: ${currentUserId ?? t("desconocido", "unknown")}`,
                              `${t("Empleado", "Employee")}: ${selectedTask?.assigned_employee_id ?? currentUserId ?? t("desconocido", "unknown")}`,
                              `${t("Restaurante", "Restaurant")}: ${getRestaurantLabelById(selectedTask?.restaurant_id)}`,
                              `${t("Turno", "Shift")}: ${selectedTask?.shift_id ?? "-"}`,
                              `${t("Tarea", "Task")}: ${selectedTaskId}`,
                              `${t("Toma", "Shot")}: close_up`,
                              taskCoords
                                ? `GPS: ${taskCoords.lat.toFixed(6)}, ${taskCoords.lng.toFixed(6)}`
                                : t("GPS: pendiente", "GPS: pending"),
                            ]}
                          />
                        </div>
                        {taskEvidenceMode === "manifest" && (
                          <>
                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                              <p className="text-sm font-semibold text-slate-700">{t("Plano medio", "Mid-range shot")}</p>
                              <p className="mb-2 text-xs text-slate-500">{t("Captura a distancia media mostrando contexto cercano.", "Capture from mid distance showing nearby context.")}</p>
                              <CameraCapture
                                onCapture={setTaskPhotoMid}
                                overlayLines={[
                                  `${t("Usuario", "User")}: ${currentUserId ?? t("desconocido", "unknown")}`,
                                  `${t("Empleado", "Employee")}: ${selectedTask?.assigned_employee_id ?? currentUserId ?? t("desconocido", "unknown")}`,
                                  `${t("Restaurante", "Restaurant")}: ${getRestaurantLabelById(selectedTask?.restaurant_id)}`,
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
                                  `${t("Restaurante", "Restaurant")}: ${getRestaurantLabelById(selectedTask?.restaurant_id)}`,
                                  `${t("Turno", "Shift")}: ${selectedTask?.shift_id ?? "-"}`,
                                  `${t("Tarea", "Task")}: ${selectedTaskId}`,
                                  `${t("Toma", "Shot")}: wide_general`,
                                  taskCoords
                                    ? `GPS: ${taskCoords.lat.toFixed(6)}, ${taskCoords.lng.toFixed(6)}`
                                    : t("GPS: pendiente", "GPS: pending"),
                                ]}
                              />
                            </div>
                          </>
                        )}
                      </div>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                        <p>GPS: {taskCoords ? "OK" : t("Pendiente", "Pending")}</p>
                        <p>{t("Primer plano", "Close-up")}: {taskPhotoClose ? "OK" : t("Pendiente", "Pending")}</p>
                        {taskEvidenceMode === "manifest" && (
                          <>
                            <p>{t("Plano medio", "Mid-range shot")}: {taskPhotoMid ? "OK" : t("Pendiente", "Pending")}</p>
                            <p>{t("Vista general", "Wide overview")}: {taskPhotoWide ? "OK" : t("Pendiente", "Pending")}</p>
                          </>
                        )}
                      </div>

                      <div className="mt-3">
                        <Button variant="primary" onClick={() => void handleCompleteTask()} disabled={processingTask}>
                          {processingTask
                            ? t("Completando...", "Completing...")
                            : taskEvidenceMode === "image"
                              ? t("Completar tarea con evidencia fotografica", "Complete task with photo evidence")
                              : t("Completar tarea con evidencia triple", "Complete task with triple evidence")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              </Card>
            )}

            {isEmpleado && (
              <Card title={t("Historial de turnos", "Shift history")}>
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
                  onAction={() => void loadEmployeeData(historyPage)}
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
              <Card title={t("Turnos programados", "Scheduled shifts")}>
              {scheduledShiftsWithUiState.length === 0 ? (
                <p className="text-sm text-slate-500">{t("No tienes turnos programados.", "You do not have scheduled shifts.")}</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                        <th className="px-3 py-2">{t("Fecha", "Date")}</th>
                        <th className="px-3 py-2">{t("Inicio", "Start")}</th>
                        <th className="px-3 py-2">{t("Fin", "End")}</th>
                        <th className="px-3 py-2">{t("Restaurante", "Restaurant")}</th>
                        <th className="px-3 py-2">{t("Estado", "Status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduledShiftsWithUiState.map(({ shift, uiState }) => (
                        <tr key={shift.id} className="border-b border-slate-100 last:border-b-0">
                          <td className="px-3 py-2 text-slate-700">{formatDateOnly(shift.scheduled_start)}</td>
                          <td className="px-3 py-2 text-slate-700">{formatTimeOnly(shift.scheduled_start)}</td>
                          <td className="px-3 py-2 text-slate-700">{formatTimeOnly(shift.scheduled_end)}</td>
                          <td className="px-3 py-2 text-slate-700">{getRestaurantLabelById(shift.restaurant_id)}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getScheduledShiftStatusClass(uiState)}`}>
                              {getScheduledShiftStatusLabel(uiState)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              </Card>
            )}
          </section>
        )}

        {canOperateSupervisor && (
          <section className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">{t("Panel de supervision", "Supervision panel")}</h2>

            {!canOperateShift && (
              <Card title={t("OTP para aprobaciones e incidentes", "OTP for approvals and incidents")}>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
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
                      "Completa OTP para aprobar/rechazar turnos y registrar incidencias.",
                      "Complete OTP to approve/reject shifts and register incidents."
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
              </Card>
            )}

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

            <Card title={t("Asignacion de personal", "Staff assignment")}>
              <div className="grid gap-2 lg:grid-cols-3">
                <select
                  value={staffRestaurantId ?? ""}
                  onChange={event => setStaffRestaurantId(Number(event.target.value) || null)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">{t("Seleccionar restaurante", "Select restaurant")}</option>
                  {staffRestaurants.map(item => (
                    <option key={item.id} value={item.id}>
                      {formatRestaurantLabel(knownRestaurantsById.get(item.id)) || item.name}
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

            <Card title={t("Programar turno", "Schedule shift")}>
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-800">{t("Programacion multiple", "Bulk scheduling")}</p>
                <p className="text-xs text-slate-500">
                  {t(
                    "Define rangos, dias o bloques manuales.",
                    "Define ranges, weekdays, or manual blocks."
                  )}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <select
                    value={supervisorScheduleEmployeeId}
                    onChange={event => setSupervisorScheduleEmployeeId(event.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">{t("Seleccionar empleado", "Select employee")}</option>
                    {supervisorScheduleEligibleUsers.map(item => (
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
                        {formatRestaurantLabel(knownRestaurantsById.get(item.id)) || item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                  <p>
                    <span className="font-semibold">{t("Empleado seleccionado", "Selected employee")}:</span> {selectedSupervisorScheduleEmployeeLabel}
                  </p>
                  <p className="mt-1">
                    <span className="font-semibold">{t("Restaurante seleccionado", "Selected restaurant")}:</span> {selectedSupervisorScheduleRestaurantLabel}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => handleApplySupervisorBulkPreset("day")}>
                    {t("1 dia (hoy)", "1 day (today)")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleApplySupervisorBulkPreset("week")}>
                    {t("1 semana", "1 week")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleApplySupervisorBulkPreset("month")}>
                    {t("1 mes", "1 month")}
                  </Button>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <input
                    type="date"
                    value={supervisorBulkRangeStart}
                    onChange={event => setSupervisorBulkRangeStart(event.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />
                  <input
                    type="date"
                    value={supervisorBulkRangeEnd}
                    onChange={event => setSupervisorBulkRangeEnd(event.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />
                  <input
                    type="time"
                    value={supervisorBulkStartTime}
                    onChange={event => setSupervisorBulkStartTime(event.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />
                  <input
                    type="time"
                    value={supervisorBulkEndTime}
                    onChange={event => setSupervisorBulkEndTime(event.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {weekdayOptions.map(day => {
                    const active = supervisorBulkWeekdays.includes(day.value)
                    return (
                      <Button
                        key={day.value}
                        size="sm"
                        variant={active ? "secondary" : "ghost"}
                        onClick={() => handleToggleSupervisorBulkWeekday(day.value)}
                      >
                        {day.label}
                      </Button>
                    )
                  })}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={handleGenerateSupervisorScheduleBlocks}>
                    {t("Generar por rango", "Generate by range")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSupervisorScheduleBlocks(prev => [
                        ...prev,
                        { id: Date.now() + Math.floor(Math.random() * 1000), start: "", end: "" },
                      ])
                    }
                  >
                    {t("Agregar bloque manual", "Add manual block")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleClearSupervisorScheduleBlocks}>
                    {t("Limpiar bloques", "Clear blocks")}
                  </Button>
                </div>

                <div className="mt-3 space-y-2">
                  {supervisorScheduleBlocks.length === 0 ? (
                    <p className="text-xs text-slate-500">{t("No hay bloques agregados.", "No blocks added.")}</p>
                  ) : (
                    supervisorScheduleBlocks.map(block => (
                      <div key={block.id} className="grid gap-2 sm:grid-cols-3">
                        <input
                          type="datetime-local"
                          value={block.start}
                          onChange={event =>
                            setSupervisorScheduleBlocks(prev =>
                              prev.map(item => (item.id === block.id ? { ...item, start: event.target.value } : item))
                            )
                          }
                          className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                        />
                        <input
                          type="datetime-local"
                          value={block.end}
                          onChange={event =>
                            setSupervisorScheduleBlocks(prev =>
                              prev.map(item => (item.id === block.id ? { ...item, end: event.target.value } : item))
                            )
                          }
                          className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                        />
                        <Button size="sm" variant="ghost" onClick={() => handleRemoveSupervisorScheduleBlock(block.id)}>
                          {t("Quitar", "Remove")}
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                <textarea
                  rows={2}
                  value={supervisorScheduleNotes}
                  onChange={event => setSupervisorScheduleNotes(event.target.value)}
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t("Notas para el turno (opcional)", "Shift notes (optional)")}
                />

                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {t("Tareas opcionales al programar", "Optional tasks while scheduling")}
                      </p>
                      <p className="text-xs text-slate-500">
                        {t(
                          "Puedes agregar cero, una o varias tareas. Se intentan crear automaticamente si ya existe turno activo.",
                          "You can add zero, one, or many tasks. They are auto-created only when an active shift already exists."
                        )}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={handleAddSupervisorScheduleTaskDraft}>
                      {t("Agregar tarea opcional", "Add optional task")}
                    </Button>
                  </div>

                  {supervisorScheduleTaskDrafts.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">
                      {t("Sin tareas opcionales.", "No optional tasks.")}
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {supervisorScheduleTaskDrafts.map(draft => (
                        <div key={draft.id} className="space-y-2 rounded-lg border border-slate-200 p-2">
                          <input
                            value={draft.title}
                            onChange={event =>
                              handleUpdateSupervisorScheduleTaskDraft(draft.id, { title: event.target.value })
                            }
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder={t("Titulo de tarea (opcional)", "Task title (optional)")}
                          />
                          <textarea
                            rows={2}
                            value={draft.description}
                            onChange={event =>
                              handleUpdateSupervisorScheduleTaskDraft(draft.id, { description: event.target.value })
                            }
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder={t("Descripcion (opcional)", "Description (optional)")}
                          />
                          <div className="grid gap-2 sm:grid-cols-3">
                            <input
                              type="datetime-local"
                              value={draft.dueAt}
                              onChange={event =>
                                handleUpdateSupervisorScheduleTaskDraft(draft.id, { dueAt: event.target.value })
                              }
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            />
                            <select
                              value={draft.priority}
                              onChange={event =>
                                handleUpdateSupervisorScheduleTaskDraft(draft.id, {
                                  priority: event.target.value as TaskPriority,
                                })
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
                              variant="ghost"
                              onClick={() => handleRemoveSupervisorScheduleTaskDraft(draft.id)}
                            >
                              {t("Quitar tarea", "Remove task")}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">
                    {t("Bloques listos", "Ready blocks")}: {supervisorScheduleBlocks.length}
                  </span>
                  <Button size="sm" onClick={() => void handleScheduleSupervisorShiftBulk()} disabled={supervisorBulkScheduling}>
                    {supervisorBulkScheduling
                      ? supervisorScheduleBlocks.length === 1
                        ? t("Guardando turno...", "Saving shift...")
                        : t("Guardando turnos...", "Saving shifts...")
                      : supervisorScheduleBlocks.length === 1
                        ? t("Programar turno", "Schedule shift")
                        : t("Programar turnos", "Schedule shifts")}
                  </Button>
                </div>
              </div>
            </Card>

            {isSupervisora && (
              <Card title={t("Entrada/salida de supervision", "Supervisor entry/exit")}>
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
                          {formatRestaurantLabel(knownRestaurantsById.get(restaurant.id)) || restaurant.name}
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
                        `${t("Restaurante", "Restaurant")}: ${getRestaurantLabelById(presenceRestaurantId)}`,
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
                          {formatDateTime(item.recorded_at)} | {t("Restaurante", "Restaurant")}: {getRestaurantLabelById(item.restaurant_id)} | {t("Fase", "Phase")}: {item.phase}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            )}

            <Card title={t("Monitoreo de tareas", "Task monitoring")}>
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

            <Card title={t("Control de turnos programados", "Scheduled shift control")}>
              {supervisionScheduledShifts.length === 0 ? (
                <p className="text-sm text-slate-500">{t("No se encontraron turnos programados.", "No scheduled shifts found.")}</p>
              ) : (
                <div className="space-y-2">
                  {supervisionScheduledShifts.slice(0, 20).map(item => {
                    const editing = editingSupervisionScheduledId === item.id
                    return (
                      <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <p className="font-medium text-slate-800">#{item.id} | {t("Empleado", "Employee")}: {item.employee_id.slice(0, 8)} | {t("Restaurante", "Restaurant")}: {getRestaurantLabelById(item.restaurant_id)}</p>
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



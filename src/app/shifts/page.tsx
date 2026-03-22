"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Manrope } from "next/font/google"

import CameraCapture from "@/components/CameraCapture"
import GPSGuard, { Coordinates } from "@/components/GPSGuard"
import Modal from "@/components/Modal"
import ProtectedRoute from "@/components/ProtectedRoute"
import Badge from "@/components/ui/Badge"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"
import { useToast } from "@/components/toast/ToastProvider"
import { buildShiftAreaCatalog } from "@/data/shiftAreas"
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
import { EvidenceMeta, uploadShiftEvidence } from "@/services/evidence.service"
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
import { debugLog } from "@/services/debug"
import {
  cancelOperationalTask,
  closeOperationalTask,
  completeOperationalTask,
  createOperationalTask,
  fetchTaskEvidenceManifest,
  listMyOperationalTasks,
  listSupervisorOperationalTasks,
  markTaskInProgress,
  OperationalTask,
  TaskPriority,
  TaskEvidenceManifestResolved,
  updateOperationalTaskDetails,
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

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
})

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
type ShiftPhotoCapture = {
  id: string
  file: Blob
  areaKey: string
  areaDetail?: string
  subareaKey?: string
  previewUrl: string
}
type SupervisionPhotoDraft = {
  id: string
  file: Blob
  areaKey: string
  areaDetail?: string
  subareaKey?: string
  previewUrl: string
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

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

function formatErrorDetails(error: unknown, fallback: string) {
  const message = extractErrorMessage(error, fallback)
  if (!error || typeof error !== "object") return message
  const details = error as { status?: unknown; code?: unknown; request_id?: unknown; details?: unknown }
  const parts: string[] = []
  if (typeof details.status === "number") parts.push(`status ${details.status}`)
  if (typeof details.code === "string" && details.code.trim()) parts.push(`code ${details.code}`)
  if (typeof details.request_id === "string" && details.request_id.trim()) parts.push(`request_id ${details.request_id}`)
  if (details.details !== undefined) {
    try {
      const raw =
        typeof details.details === "string" ? details.details : JSON.stringify(details.details)
      if (raw && raw.trim()) parts.push(raw.trim())
    } catch {
      // ignore details serialization errors
    }
  }
  if (parts.length === 0) return message
  return `${message} (${parts.join(" | ")})`
}

function isConsentPendingError(error: unknown) {
  if (typeof error !== "object" || error === null) return false

  const status = (error as { status?: unknown }).status
  if (status === 403) return true

  const message = extractErrorMessage(error, "").toLowerCase()
  return message.includes("consent") || message.includes("legal") || message.includes("data processing")
}

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

      return nowMs <= endMs
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

async function reverseAddressFromCoordinates(lat: number, lng: number) {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lng),
    zoom: "18",
    addressdetails: "1",
  })

  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 9000)
  let response: Response
  try {
    response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    })
  } finally {
    globalThis.clearTimeout(timeoutId)
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const payload = (await response.json()) as { display_name?: string }
  if (typeof payload?.display_name === "string" && payload.display_name.trim()) {
    return payload.display_name.trim()
  }
  return ""
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

function ShiftsPageContent() {
  const { loading: roleLoading, isEmpleado, isSupervisora, isSuperAdmin } = useRole()
  const { formatDateTime: formatDateTimeI18n, t } = useI18n()
  const { user, logout } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()

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
  const [startPhotoCaptures, setStartPhotoCaptures] = useState<ShiftPhotoCapture[]>([])
  const [endPhotoCaptures, setEndPhotoCaptures] = useState<ShiftPhotoCapture[]>([])
  const [startCameraOpen, setStartCameraOpen] = useState(false)
  const [endCameraOpen, setEndCameraOpen] = useState(false)
  const [showShiftSummary, setShowShiftSummary] = useState(false)
  const [specialTaskDone, setSpecialTaskDone] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle")
  const [gpsMessage, setGpsMessage] = useState("")
  const [presenceGpsStatus, setPresenceGpsStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle")
  const [presenceGpsMessage, setPresenceGpsMessage] = useState("")
  const [coordsAddress, setCoordsAddress] = useState("")
  const [taskAddress, setTaskAddress] = useState("")
  const [presenceAddress, setPresenceAddress] = useState("")
  const [startAreaKey, setStartAreaKey] = useState("")
  const [startAreaDetail, setStartAreaDetail] = useState("")
  const [startSubareaKey, setStartSubareaKey] = useState("")
  const [endAreaKey, setEndAreaKey] = useState("")
  const [endAreaDetail, setEndAreaDetail] = useState("")
  const [endSubareaKey, setEndSubareaKey] = useState("")
  const [activeShift, setActiveShift] = useState<ShiftRecord | null>(null)
  const [history, setHistory] = useState<ShiftRecord[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [uploadingStartEvidence, setUploadingStartEvidence] = useState(false)
  const [uploadingEndEvidence, setUploadingEndEvidence] = useState(false)
  const [localStartEvidenceShiftId, setLocalStartEvidenceShiftId] = useState<string | number | null>(null)
  const [endEvidenceUploadedShiftId, setEndEvidenceUploadedShiftId] = useState<string | number | null>(null)
  const [startEvidencePhotoCount, setStartEvidencePhotoCount] = useState(0)
  const [endEvidencePhotoCount, setEndEvidencePhotoCount] = useState(0)
  const [supervisorScreen, setSupervisorScreen] = useState<
    "home" | "turnos" | "otp" | "staff" | "schedule" | "presence" | "tasks" | "scheduled" | "active" | "alerts"
  >("home")
  const [supervisorScreenHistory, setSupervisorScreenHistory] = useState<Array<typeof supervisorScreen>>(["home"])
  const [startRecoveryPhoto, setStartRecoveryPhoto] = useState<Blob | null>(null)
  const [endEvidenceUploadError, setEndEvidenceUploadError] = useState<string | null>(null)
  const [endShiftError, setEndShiftError] = useState<string | null>(null)
  const [activeScheduledMeta, setActiveScheduledMeta] = useState<{
    shiftId: string | number
    scheduledEndMs: number | null
    restaurantId?: number | null
  } | null>(null)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [verifyingOtp, setVerifyingOtp] = useState(false)
  const [otpCode, setOtpCode] = useState("")
  const [shiftOtpReady, setShiftOtpReady] = useState(false)
  const [otpVerifiedAt, setOtpVerifiedAt] = useState<string | null>(null)
  const [otpDebugCode, setOtpDebugCode] = useState<string | null>(null)
  const [otpDebugMaskedPhone, setOtpDebugMaskedPhone] = useState<string | null>(null)
  const [otpDebugExpiresAt, setOtpDebugExpiresAt] = useState<string | null>(null)
  const [clockMs, setClockMs] = useState(() => Date.now())
  const [historyPage, setHistoryPage] = useState(1)
  const [, setHistoryTotalPages] = useState(1)
  const [scheduledShifts, setScheduledShifts] = useState<ScheduledShift[]>([])
  const [supervisionScheduledShifts, setSupervisionScheduledShifts] = useState<ScheduledShift[]>([])
  const [startObservation, setStartObservation] = useState("")
  const [endObservation, setEndObservation] = useState("")
  const [startFitForWork, setStartFitForWork] = useState<boolean | null>(null)
  const [endFitForWork, setEndFitForWork] = useState<boolean | null>(null)
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
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null)
  const [editingTaskTitle, setEditingTaskTitle] = useState("")
  const [editingTaskDescription, setEditingTaskDescription] = useState("")
  const [editingTaskPriority, setEditingTaskPriority] = useState<TaskPriority>("normal")
  const [editingTaskDueAt, setEditingTaskDueAt] = useState("")
  const [savingTaskEditId, setSavingTaskEditId] = useState<number | null>(null)
  const [closingTaskId, setClosingTaskId] = useState<number | null>(null)
  const [cancelingTaskId, setCancelingTaskId] = useState<number | null>(null)
  const [newTaskByShift, setNewTaskByShift] = useState<Record<string, { title: string; description: string; priority: TaskPriority; dueAt: string }>>({})
  const [creatingTaskForShift, setCreatingTaskForShift] = useState<string | null>(null)

  const [supervisorPresence, setSupervisorPresence] = useState<SupervisorPresenceLog[]>([])
  const [presenceRestaurants, setPresenceRestaurants] = useState<SupervisorRestaurantOption[]>([])
  const [presenceRestaurantId, setPresenceRestaurantId] = useState<number | null>(null)
  const [presenceCoords, setPresenceCoords] = useState<Coordinates | null>(null)
  const [presencePhoto, setPresencePhoto] = useState<Blob | null>(null)
  const [presenceNotes, setPresenceNotes] = useState("")
  const [presencePhase, setPresencePhase] = useState<"start" | "end">("start")
  const [supervisionStep, setSupervisionStep] = useState<"start" | "cleaning" | "end">("start")
  const [supervisionStartPhotos, setSupervisionStartPhotos] = useState<SupervisionPhotoDraft[]>([])
  const [supervisionEndPhotos, setSupervisionEndPhotos] = useState<SupervisionPhotoDraft[]>([])
  const [supervisionCameraOpen, setSupervisionCameraOpen] = useState(false)
  const [supervisionAreaKey, setSupervisionAreaKey] = useState("")
  const [supervisionAreaDetail, setSupervisionAreaDetail] = useState("")
  const [supervisionSubareaKey, setSupervisionSubareaKey] = useState("")
  const [supervisionObservation, setSupervisionObservation] = useState("")
  const [supervisionUploading, setSupervisionUploading] = useState(false)
  const [supervisionSessionId, setSupervisionSessionId] = useState<string>(() => crypto.randomUUID())
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
  const [shiftSuccess, setShiftSuccess] = useState<{
    restaurantLabel: string
    startTime: string
    endTime: string
    photos: number
    completedTasks: number
  } | null>(null)
  const [cleaningMode, setCleaningMode] = useState(true)
  const startEvidenceSeenRef = useRef(false)
  type EvidenceCachePayload = { shiftId: string; photoCount: number }
  const evidenceStorageKeySuffix = useMemo(
    () => (currentUserId ?? user?.id ?? "anon"),
    [currentUserId, user?.id]
  )
  const startEvidenceStorageKey = useMemo(
    () => `wt.shift.startEvidence.${evidenceStorageKeySuffix}`,
    [evidenceStorageKeySuffix]
  )
  const endEvidenceStorageKey = useMemo(
    () => `wt.shift.endEvidence.${evidenceStorageKeySuffix}`,
    [evidenceStorageKeySuffix]
  )
  const readEvidenceCache = useCallback((key: string): EvidenceCachePayload | null => {
    if (typeof window === "undefined") return null
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { shiftId?: unknown; photoCount?: unknown } | null
      if (!parsed || typeof parsed !== "object") return null
      const shiftId = typeof parsed.shiftId === "string" ? parsed.shiftId : String(parsed.shiftId ?? "")
      const photoCount =
        typeof parsed.photoCount === "number" && Number.isFinite(parsed.photoCount)
          ? parsed.photoCount
          : Number(parsed.photoCount)
      if (!shiftId || !Number.isFinite(photoCount) || photoCount <= 0) return null
      return { shiftId, photoCount }
    } catch {
      return null
    }
  }, [])
  const writeEvidenceCache = useCallback((key: string, payload: EvidenceCachePayload | null) => {
    if (typeof window === "undefined") return
    try {
      if (!payload) {
        window.localStorage.removeItem(key)
        return
      }
      window.localStorage.setItem(key, JSON.stringify(payload))
    } catch {
      // Best effort only.
    }
  }, [])
  const readStartEvidenceCache = useCallback(
    () => readEvidenceCache(startEvidenceStorageKey),
    [readEvidenceCache, startEvidenceStorageKey]
  )
  const writeStartEvidenceCache = useCallback(
    (payload: EvidenceCachePayload | null) => writeEvidenceCache(startEvidenceStorageKey, payload),
    [startEvidenceStorageKey, writeEvidenceCache]
  )
  const readEndEvidenceCache = useCallback(
    () => readEvidenceCache(endEvidenceStorageKey),
    [endEvidenceStorageKey, readEvidenceCache]
  )
  const writeEndEvidenceCache = useCallback(
    (payload: EvidenceCachePayload | null) => writeEvidenceCache(endEvidenceStorageKey, payload),
    [endEvidenceStorageKey, writeEvidenceCache]
  )

  const healthAnswered = activeShift ? endFitForWork !== null : startFitForWork !== null
  const healthDeclarationRequired =
    activeShift ? endFitForWork === false : startFitForWork === false
  const healthDeclarationProvided = activeShift
    ? endHealthDeclaration.trim().length > 0
    : startHealthDeclaration.trim().length > 0

  const startChecklistComplete = startFitForWork !== null
  const endChecklistComplete = endIncidentsOccurred !== null && endAreaDelivered !== null

  const canOperateEmployee = !roleLoading && isEmpleado
  const canOperateShift = !roleLoading && isEmpleado
  const canOperateSupervisor = !roleLoading && (isSupervisora || isSuperAdmin)
  const canOperateOtp = canOperateShift || canOperateSupervisor
  const employeeViewRaw = searchParams.get("view") ?? "start"
  const allowedEmployeeViews = ["start", "start-evidence", "cleaning", "end", "profile"] as const
  type EmployeeView = (typeof allowedEmployeeViews)[number]
  const employeeView = (allowedEmployeeViews as readonly string[]).includes(employeeViewRaw as EmployeeView)
    ? (employeeViewRaw as EmployeeView)
    : "start"

  const displayName = useMemo(() => {
    const raw =
      (user?.user_metadata?.full_name as string | undefined) ??
      (user?.user_metadata?.name as string | undefined) ??
      (user?.user_metadata?.first_name as string | undefined) ??
      user?.email ??
      ""
    const cleaned = typeof raw === "string" ? raw.trim() : ""
    if (cleaned) return cleaned
    return t("Usuario", "User")
  }, [t, user])
  const shiftAreaCatalog = useMemo(() => buildShiftAreaCatalog(t), [t])
  const shiftAreaOptions = useMemo(
    () => shiftAreaCatalog.map(area => ({ value: area.value, label: area.label })),
    [shiftAreaCatalog]
  )
  const subareaOptionsByArea = useMemo(
    () => new Map(shiftAreaCatalog.map(area => [area.value, area.subareas])),
    [shiftAreaCatalog]
  )
  const areaLabelByKey = useMemo(
    () => new Map(shiftAreaOptions.map(option => [option.value, option.label])),
    [shiftAreaOptions]
  )
  const subareaLabelByArea = useMemo(() => {
    const map = new Map<string, Map<string, string>>()
    shiftAreaCatalog.forEach(area => {
      map.set(area.value, new Map(area.subareas.map(sub => [sub.value, sub.label])))
    })
    return map
  }, [shiftAreaCatalog])
  const getAreaLabel = useCallback(
    (key: string, detail?: string, subKey?: string) => {
      if (!key) return t("Area pendiente", "Area pending")
      const base = areaLabelByKey.get(key) ?? key
      if (key === "otro") {
        if (detail && detail.trim()) return `${base}: ${detail.trim()}`
        return base
      }
      const subMap = subareaLabelByArea.get(key)
      const subLabel = subKey ? subMap?.get(subKey) : undefined
      return subLabel ? `${base} · ${subLabel}` : base
    },
    [areaLabelByKey, subareaLabelByArea, t]
  )
  const supervisionSubareas = useMemo(
    () => subareaOptionsByArea.get(supervisionAreaKey) ?? [],
    [subareaOptionsByArea, supervisionAreaKey]
  )
  const buildEvidenceMeta = useCallback(
    (areaKey: string, areaDetail?: string, subKey?: string): EvidenceMeta | undefined => {
      if (!areaKey) return undefined
      const areaLabel = areaLabelByKey.get(areaKey) ?? areaKey
      const payload: EvidenceMeta = {
        area_key: areaKey,
        area_label: areaLabel,
      }

      if (areaKey === "otro" && areaDetail && areaDetail.trim().length > 0) {
        payload.area_detail = areaDetail.trim()
      }

      if (subKey) {
        const subLabel = subareaLabelByArea.get(areaKey)?.get(subKey) ?? subKey
        payload.subarea_key = subKey
        payload.subarea_label = subLabel
      }

      return payload
    },
    [areaLabelByKey, subareaLabelByArea]
  )
  const isAreaComplete = useCallback((areaKey: string, detail?: string, subKey?: string) => {
    if (!areaKey) return false
    if (areaKey !== "otro") {
      return !!subKey
    }
    return !!detail && detail.trim().length > 0
  }, [])
  const startPhotosReady = useMemo(
    () =>
      startPhotoCaptures.length > 0 &&
      startPhotoCaptures.every(item => isAreaComplete(item.areaKey, item.areaDetail, item.subareaKey)),
    [isAreaComplete, startPhotoCaptures]
  )
  const endPhotosReady = useMemo(
    () =>
      endPhotoCaptures.length > 0 &&
      endPhotoCaptures.every(item => isAreaComplete(item.areaKey, item.areaDetail, item.subareaKey)),
    [endPhotoCaptures, isAreaComplete]
  )
  const pendingSpecialTasks = useMemo(
    () => employeeDashboard?.pending_tasks_preview ?? [],
    [employeeDashboard]
  )
  const handleEmployeeView = useCallback(
    (view: EmployeeView) => {
      router.push(`/shifts?view=${view}`)
    },
    [router]
  )
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
  const elapsedShiftMs = useMemo(() => {
    if (!activeShift?.start_time) return 0
    const startMs = new Date(activeShift.start_time).getTime()
    if (!Number.isFinite(startMs)) return 0
    return Math.max(0, clockMs - startMs)
  }, [activeShift?.start_time, clockMs])
  const endEvidenceUploaded = useMemo(() => {
    if (activeShiftUploadedEvidenceTypes.includes("fin")) return true
    if (!activeShift?.id || !endEvidenceUploadedShiftId) return false
    return String(activeShift.id) === String(endEvidenceUploadedShiftId)
  }, [activeShift?.id, activeShiftUploadedEvidenceTypes, endEvidenceUploadedShiftId])
  const endEvidenceCount = useMemo(() => {
    if (endEvidenceUploaded) {
      return Math.max(endEvidencePhotoCount, 1)
    }
    return endPhotoCaptures.length
  }, [endEvidenceUploaded, endEvidencePhotoCount, endPhotoCaptures.length])
  const expectedEndPhotoCount = startEvidencePhotoCount > 0 ? startEvidencePhotoCount : null
  const endPhotosMeetExpected = expectedEndPhotoCount ? endPhotoCaptures.length >= expectedEndPhotoCount : true
  const startPhotoTarget = shiftAreaOptions.length > 0 ? shiftAreaOptions.length : Math.max(startPhotoCaptures.length, 1)
  const startPhotoProgress = Math.min(100, (startPhotoCaptures.length / startPhotoTarget) * 100)
  const canContinueToPhotos = gpsStatus === "valid" && startFitForWork === true
  const employeeStage = useMemo(() => {
    if (!isEmpleado) return null
    if (activeShift) {
      if (!hasStartEvidence) return "start-evidence" as const
      if (cleaningMode && !endEvidenceUploaded) return "cleaning" as const
      return "end" as const
    }
    if (employeeView === "cleaning" || employeeView === "end") return "start"
    return employeeView
  }, [activeShift, cleaningMode, employeeView, endEvidenceUploaded, hasStartEvidence, isEmpleado])
  const isEmployeeStartInfoStage = isEmpleado && employeeStage === "start"
  const isEmployeeStartEvidenceStage = isEmpleado && employeeStage === "start-evidence"
  const isEmployeeCleaningStage = isEmpleado && employeeStage === "cleaning"
  const isEmployeeEndStage = isEmpleado && employeeStage === "end"
  const isEmployeeProfileStage = isEmpleado && employeeStage === "profile"

  useEffect(() => {
    const hadStartEvidence = startEvidenceSeenRef.current
    if (!hadStartEvidence && hasStartEvidence && activeShift && !endEvidenceUploaded) {
      setCleaningMode(true)
    }
    if (!activeShift || endEvidenceUploaded) {
      setCleaningMode(false)
    }
    startEvidenceSeenRef.current = hasStartEvidence
  }, [activeShift, endEvidenceUploaded, hasStartEvidence])

  useEffect(() => {
    if (employeeView !== "end") {
      setShowShiftSummary(false)
    }
    if (employeeView !== "start-evidence") {
      setStartCameraOpen(false)
    }
    if (employeeView !== "end") {
      setEndCameraOpen(false)
    }
  }, [employeeView])

  useEffect(() => {
    if (!isEmpleado || !activeShift || !hasStartEvidence) return
    if (endIncidentsOccurred === null) setEndIncidentsOccurred(false)
    if (endAreaDelivered === null) setEndAreaDelivered(true)
    if (endFitForWork === null) setEndFitForWork(true)
  }, [activeShift, endAreaDelivered, endFitForWork, endIncidentsOccurred, hasStartEvidence, isEmpleado])

  useEffect(() => {
    setSupervisionCameraOpen(false)
  }, [supervisionStep])
  const employeeTasksForShift = useMemo(() => {
    if (!activeShiftId) return [] as OperationalTask[]
    return employeeTasks.filter(task => String(task.shift_id ?? "") === String(activeShiftId))
  }, [activeShiftId, employeeTasks])
  const completedEmployeeTasks = useMemo(
    () => employeeTasksForShift.filter(task => task.status === "completed"),
    [employeeTasksForShift]
  )
  const pendingEmployeeTasks = useMemo(
    () => employeeTasksForShift.filter(task => task.status === "pending" || task.status === "in_progress"),
    [employeeTasksForShift]
  )
  const profileInitials = useMemo(() => {
    const parts = displayName.split(" ").filter(Boolean)
    if (parts.length === 0) return "WT"
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
  }, [displayName])
  const profilePhone = useMemo(() => {
    const metadata = user?.user_metadata as { phone?: string; phone_number?: string } | undefined
    return metadata?.phone ?? metadata?.phone_number ?? t("Sin teléfono", "No phone")
  }, [t, user?.user_metadata])
  const upcomingShiftsCount = scheduledShifts.length
  const pendingTasksCount = employeeDashboard?.pending_tasks_count ?? pendingEmployeeTasks.length
  const scheduleHoursValue = useMemo(() => {
    if (!supervisorBulkStartTime || !supervisorBulkEndTime) return 0
    const [startH, startM] = supervisorBulkStartTime.split(":").map(Number)
    const [endH, endM] = supervisorBulkEndTime.split(":").map(Number)
    if (!Number.isFinite(startH) || !Number.isFinite(startM) || !Number.isFinite(endH) || !Number.isFinite(endM)) {
      return 0
    }
    const minutes = endH * 60 + endM - (startH * 60 + startM)
    return minutes > 0 ? Math.round(minutes / 60) : 0
  }, [supervisorBulkEndTime, supervisorBulkStartTime])
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
  const monthHoursValue = useMemo(() => Math.round(totalWorkedMinutes / 60), [totalWorkedMinutes])

  useEffect(() => {
    const intervalId = window.setInterval(() => setClockMs(Date.now()), 1000)
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

  const currentScheduledShift = useMemo(
    () => findEligibleScheduledShift(scheduledShifts, clockMs),
    [clockMs, scheduledShifts]
  )

  const activeScheduledShift = useMemo(() => {
    if (!activeShift || scheduledShifts.length === 0) return null
    const startMs = new Date(activeShift.start_time).getTime()
    if (!Number.isFinite(startMs)) return null

    const shiftRestaurantId = Number(
      (activeShift as { restaurant_id?: unknown; restaurantId?: unknown }).restaurant_id ??
        (activeShift as { restaurantId?: unknown }).restaurantId ??
        NaN
    )

    const candidates = scheduledShifts.filter(item => {
      if (!item.scheduled_start || !item.scheduled_end) return false
      const status = (item.status ?? "").toLowerCase()
      if (status === "cancelled" || status === "canceled") return false
      if (status === "completed" || status === "finished" || status === "finalizado") return false
      if (Number.isFinite(shiftRestaurantId)) {
        return Number(item.restaurant_id) === shiftRestaurantId
      }
      return true
    })

    let best: { shift: ScheduledShift; score: number } | null = null
    for (const item of candidates) {
      const itemStart = new Date(item.scheduled_start).getTime()
      const itemEnd = new Date(item.scheduled_end).getTime()
      if (!Number.isFinite(itemStart) || !Number.isFinite(itemEnd)) continue
      if (startMs > itemEnd) continue
      const score = Math.abs(startMs - itemStart)
      if (!best || score < best.score) {
        best = { shift: item, score }
      }
    }

    if (best) return best.shift
    return null
  }, [activeShift, scheduledShifts])

  const summaryDurationLabel = useMemo(() => {
    if (!activeShift?.start_time) return "-"
    const totalMinutes = Math.max(0, Math.floor(elapsedShiftMs / 60000))
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours === 0 && minutes === 0) return "0h"
    if (minutes === 0) return `${hours}h`
    return `${hours}h ${minutes}m`
  }, [activeShift?.start_time, elapsedShiftMs])

  const summaryScheduleLabel = useMemo(() => {
    const dashboardStart = employeeDashboard?.active_shift?.scheduled_start
    const dashboardEnd = employeeDashboard?.active_shift?.scheduled_end
    if (dashboardStart && dashboardEnd) {
      return `${formatTimeOnly(dashboardStart)} - ${formatTimeOnly(dashboardEnd)}`
    }
    if (activeScheduledShift?.scheduled_start && activeScheduledShift?.scheduled_end) {
      return `${formatTimeOnly(activeScheduledShift.scheduled_start)} - ${formatTimeOnly(activeScheduledShift.scheduled_end)}`
    }
    if (activeShift?.start_time) {
      return `${formatTimeOnly(activeShift.start_time)} - ${formatTimeOnly(new Date().toISOString())}`
    }
    return "-"
  }, [
    activeScheduledShift?.scheduled_end,
    activeScheduledShift?.scheduled_start,
    activeShift?.start_time,
    employeeDashboard?.active_shift?.scheduled_end,
    employeeDashboard?.active_shift?.scheduled_start,
  ])

  const summaryDateLabel = useMemo(() => {
    if (activeShift?.start_time) return formatDateOnly(activeShift.start_time)
    return formatDateOnly(new Date().toISOString())
  }, [activeShift?.start_time])

  const currentScheduledRestaurant = useMemo(() => {
    const currentRestaurantId = currentScheduledShift?.restaurant_id ?? null
    if (!currentRestaurantId) return null
    return knownRestaurants.find(item => Number(item.id) === Number(currentRestaurantId)) ?? null
  }, [currentScheduledShift, knownRestaurants])

  const activeScheduledEndMs = useMemo(() => {
    if (!activeShift) return null
    const metaMatch =
      activeScheduledMeta &&
      String(activeScheduledMeta.shiftId) === String(activeShift.id) &&
      Number.isFinite(activeScheduledMeta.scheduledEndMs)
        ? activeScheduledMeta.scheduledEndMs
        : null
    if (typeof metaMatch === "number") return metaMatch
    const dashboardScheduledEnd = employeeDashboard?.active_shift?.scheduled_end
    if (dashboardScheduledEnd) {
      const endMs = new Date(dashboardScheduledEnd).getTime()
      if (Number.isFinite(endMs)) return endMs
    }
    if (!activeScheduledShift?.scheduled_end) return null
    const endMs = new Date(activeScheduledShift.scheduled_end).getTime()
    return Number.isFinite(endMs) ? endMs : null
  }, [activeScheduledMeta, activeScheduledShift, activeShift, employeeDashboard?.active_shift?.scheduled_end])

  const earlyEndReasonRequired = useMemo(() => {
    if (!activeShift || activeScheduledEndMs === null) return false
    return clockMs < activeScheduledEndMs
  }, [activeShift, clockMs, activeScheduledEndMs])

  const canSubmit =
    !!coords &&
    (activeShift ? endEvidenceUploaded : startPhotosReady) &&
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

  const getRestaurantWatermarkLabelById = useCallback(
    (restaurantId: number | null | undefined) => {
      if (!restaurantId) return "-"
      const restaurant = knownRestaurantsById.get(Number(restaurantId))
      if (!restaurant) return `#${restaurantId}`
      const addressLine = typeof restaurant.address_line === "string" ? restaurant.address_line.trim() : ""
      const name = restaurant.name || `#${restaurantId}`
      return addressLine ? `${name} (${addressLine})` : name
    },
    [knownRestaurantsById]
  )

  const getSupervisorStatusBadge = useCallback(
    (status: string | null | undefined) => {
      const normalized = (status ?? "").toLowerCase()
      if (normalized.includes("active") || normalized.includes("in_progress") || normalized.includes("activo")) {
        return { label: t("Activo", "Active"), className: "status-badge status-active" }
      }
      if (normalized.includes("pending") || normalized.includes("programado") || normalized.includes("scheduled")) {
        return { label: t("Pendiente", "Pending"), className: "status-badge status-pending" }
      }
      if (normalized.includes("cancel") || normalized.includes("rejected") || normalized.includes("inactive")) {
        return { label: t("Inactivo", "Inactive"), className: "status-badge status-inactive" }
      }
      return { label: status ?? t("Sin estado", "No status"), className: "status-badge status-pending" }
    },
    [t]
  )

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

  const activeRestaurantLabel = useMemo(() => {
    const restaurantId =
      activeShift?.restaurant_id ?? employeeDashboard?.active_shift?.restaurant_id ?? expectedRestaurantId
    if (!restaurantId) return t("Restaurante", "Restaurant")
    return getRestaurantLabelById(restaurantId)
  }, [
    activeShift?.restaurant_id,
    employeeDashboard?.active_shift?.restaurant_id,
    expectedRestaurantId,
    getRestaurantLabelById,
    t,
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

  const verifyEmployeeGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus("invalid")
      setGpsMessage(t("GPS no disponible en este dispositivo.", "GPS not available on this device."))
      setCoords(null)
      return
    }

    setGpsStatus("checking")
    setGpsMessage(t("Verificando GPS...", "Checking GPS..."))

    navigator.geolocation.getCurrentPosition(
      position => {
        const nextCoords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined,
          capturedAtMs: Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
        }

        let withinRange = true
        if (
          geofenceTarget &&
          geofenceTarget.lat !== null &&
          geofenceTarget.lng !== null &&
          geofenceTarget.geofence_radius_m !== null
        ) {
          const meters = distanceMeters(
            { lat: nextCoords.lat, lng: nextCoords.lng },
            { lat: Number(geofenceTarget.lat), lng: Number(geofenceTarget.lng) }
          )
          withinRange = meters <= Number(geofenceTarget.geofence_radius_m)
        }

        setCoords(nextCoords)
        setGpsStatus(withinRange ? "valid" : "invalid")
        setGpsMessage(
          withinRange
            ? t("Ubicación verificada - Dentro del rango permitido", "Location verified - Within allowed range")
            : t("Ubicación fuera del rango permitido", "Location outside the allowed range")
        )
      },
      error => {
        let message = t("No se pudo verificar la ubicación.", "Could not verify location.")
        if (error.code === error.PERMISSION_DENIED) {
          message = t("Permiso de ubicación denegado.", "Location permission denied.")
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          message = t("Ubicación no disponible.", "Location unavailable.")
        } else if (error.code === error.TIMEOUT) {
          message = t("Tiempo agotado al solicitar GPS.", "GPS request timed out.")
        }
        setCoords(null)
        setGpsStatus("invalid")
        setGpsMessage(message)
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    )
  }, [geofenceTarget, t])

  const verifyPresenceGps = useCallback(() => {
    if (!navigator.geolocation) {
      setPresenceGpsStatus("invalid")
      setPresenceGpsMessage(t("GPS no disponible en este dispositivo.", "GPS not available on this device."))
      setPresenceCoords(null)
      return
    }

    setPresenceGpsStatus("checking")
    setPresenceGpsMessage(t("Verificando GPS...", "Checking GPS..."))

    navigator.geolocation.getCurrentPosition(
      position => {
        const nextCoords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined,
          capturedAtMs: Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
        }
        setPresenceCoords(nextCoords)
        setPresenceGpsStatus("valid")
        setPresenceGpsMessage(t("Ubicación verificada", "Location verified"))
      },
      error => {
        let message = t("No se pudo verificar la ubicación.", "Could not verify location.")
        if (error.code === error.PERMISSION_DENIED) {
          message = t("Permiso de ubicación denegado.", "Location permission denied.")
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          message = t("Ubicación no disponible.", "Location unavailable.")
        } else if (error.code === error.TIMEOUT) {
          message = t("Tiempo agotado al solicitar GPS.", "GPS request timed out.")
        }
        setPresenceCoords(null)
        setPresenceGpsStatus("invalid")
        setPresenceGpsMessage(message)
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    )
  }, [t])

  useEffect(() => {
    if (!isEmpleado) return
    if (isEmployeeStartInfoStage && gpsStatus === "idle") {
      verifyEmployeeGps()
    }
  }, [gpsStatus, isEmpleado, isEmployeeStartInfoStage, verifyEmployeeGps])

  useEffect(() => {
    if (!canOperateSupervisor || supervisorScreen !== "presence") return
    if (presenceGpsStatus === "idle") {
      verifyPresenceGps()
    }
  }, [canOperateSupervisor, presenceGpsStatus, supervisorScreen, verifyPresenceGps])

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
          "No hay turno programado disponible o el turno ya vencio.",
          "No scheduled shift is available or the shift already expired."
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
    if (!activeShift && startPhotoCaptures.length === 0) {
      blockers.push(t("Debes capturar fotos de ingreso.", "You must capture entry photos."))
    }
    if (!activeShift && startPhotoCaptures.length > 0 && !startPhotosReady) {
      blockers.push(t("Selecciona el area y subarea en cada foto de ingreso.", "Select area and subarea for each entry photo."))
    }
    if (activeShift && hasStartEvidence && !endEvidenceUploaded) {
      if (endPhotoCaptures.length === 0) {
        blockers.push(t("Debes capturar fotos de salida.", "You must capture exit photos."))
      } else if (expectedEndPhotoCount && endPhotoCaptures.length < expectedEndPhotoCount) {
        blockers.push(
          t(
            `Debes tomar al menos ${expectedEndPhotoCount} fotos de salida (las mismas del inicio).`,
            `You must take at least ${expectedEndPhotoCount} exit photos (same as start).`
          )
        )
      } else if (!endPhotosReady) {
        blockers.push(t("Selecciona el area y subarea en cada foto de salida.", "Select area and subarea for each exit photo."))
      } else {
        blockers.push(t("Debes registrar el fin de la tarea.", "Register the task end before finishing."))
      }
    }
    if (!shiftOtpReady) {
      blockers.push(
        t(
          "Debes validar OTP para iniciar/finalizar turno.",
          "OTP verification is required to start/end shift."
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
      blockers.push(t("Completa el certificado de aptitud.", "Complete the fitness certificate."))
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
    startPhotoCaptures.length,
    startPhotosReady,
    endPhotoCaptures.length,
    endPhotosReady,
    endEvidenceUploaded,
    expectedEndPhotoCount,
    t,
  ])

  const shiftEvidencePhase = activeShift
    ? hasStartEvidence
      ? t("fin-turno", "shift-end")
      : t("inicio-turno", "shift-start")
    : t("inicio-turno", "shift-start")

  const shiftOverlayLines = [
    coordsAddress
      ? `${t("Direccion", "Address")}: ${coordsAddress}`
      : t("Direccion: pendiente", "Address: pending"),
    `${t("Restaurante", "Restaurant")}: ${getRestaurantWatermarkLabelById(expectedRestaurantId)}`,
  ]
  const startOverlayLines = useMemo(() => [...shiftOverlayLines], [shiftOverlayLines])
  const endOverlayLines = useMemo(() => [...shiftOverlayLines], [shiftOverlayLines])

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
    if (!activeShift && !employeeDashboard?.active_shift) {
      setLocalStartEvidenceShiftId(null)
    }
  }, [activeShift, employeeDashboard?.active_shift])

  useEffect(() => {
    if (!activeShift?.id) return
    const cached = readStartEvidenceCache()
    if (!cached) return
    if (String(cached.shiftId) !== String(activeShift.id)) return
    if (!localStartEvidenceShiftId) {
      setLocalStartEvidenceShiftId(cached.shiftId)
    }
    if (startEvidencePhotoCount === 0 && cached.photoCount > 0) {
      setStartEvidencePhotoCount(cached.photoCount)
    }
  }, [activeShift?.id, localStartEvidenceShiftId, readStartEvidenceCache, startEvidencePhotoCount])

  useEffect(() => {
    if (!activeShift?.id) return
    if (!localStartEvidenceShiftId || startEvidencePhotoCount <= 0) return
    if (String(localStartEvidenceShiftId) !== String(activeShift.id)) return
    writeStartEvidenceCache({ shiftId: String(activeShift.id), photoCount: startEvidencePhotoCount })
  }, [activeShift?.id, localStartEvidenceShiftId, startEvidencePhotoCount, writeStartEvidenceCache])

  useEffect(() => {
    if (!activeShift?.id) return
    const cached = readEndEvidenceCache()
    if (!cached) return
    if (String(cached.shiftId) !== String(activeShift.id)) return
    if (!endEvidenceUploadedShiftId) {
      setEndEvidenceUploadedShiftId(activeShift.id)
    }
    if (endEvidencePhotoCount === 0 && cached.photoCount > 0) {
      setEndEvidencePhotoCount(cached.photoCount)
    }
  }, [activeShift?.id, endEvidencePhotoCount, endEvidenceUploadedShiftId, readEndEvidenceCache])

  useEffect(() => {
    if (!activeShift?.id) return
    if (!endEvidenceUploadedShiftId || endEvidencePhotoCount <= 0) return
    if (String(endEvidenceUploadedShiftId) !== String(activeShift.id)) return
    writeEndEvidenceCache({ shiftId: String(activeShift.id), photoCount: endEvidencePhotoCount })
  }, [activeShift?.id, endEvidenceUploadedShiftId, endEvidencePhotoCount, writeEndEvidenceCache])

  useEffect(() => {
    if (loadingData) return
    if (activeShift || !employeeDashboard?.active_shift) return
    const fallbackId = employeeDashboard.active_shift.id
    if (!fallbackId) return
    setActiveShift({
      id: String(fallbackId),
      start_time: employeeDashboard.active_shift.start_time ?? new Date().toISOString(),
      end_time: null,
      status: "active",
      restaurant_id: employeeDashboard.active_shift.restaurant_id ?? null,
    })
  }, [activeShift, employeeDashboard?.active_shift, loadingData])

  useEffect(() => {
    if (roleLoading) return
    if (!canOperateOtp) return
    getOrCreateDeviceFingerprint()
    setShiftOtpReady(Boolean(getShiftOtpToken()))
  }, [canOperateOtp, roleLoading])

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
    if (!activeShift) {
      setActiveScheduledMeta(null)
    }
  }, [activeShift])

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

  const addressCacheRef = useRef<Map<string, string>>(new Map())

  const resolveAddressLabel = useCallback(async (location: Coordinates | null, setter: (value: string) => void) => {
    if (!location) {
      setter("")
      return
    }

    const key = `${location.lat.toFixed(5)}|${location.lng.toFixed(5)}`
    const cached = addressCacheRef.current.get(key)
    if (cached !== undefined) {
      setter(cached)
      return
    }

    try {
      const label = await reverseAddressFromCoordinates(location.lat, location.lng)
      addressCacheRef.current.set(key, label)
      setter(label)
    } catch {
      addressCacheRef.current.set(key, "")
      setter("")
    }
  }, [])

  useEffect(() => {
    let active = true
    void resolveAddressLabel(coords, value => {
      if (active) setCoordsAddress(value)
    })
    return () => {
      active = false
    }
  }, [coords?.lat, coords?.lng, resolveAddressLabel])

  useEffect(() => {
    let active = true
    void resolveAddressLabel(taskCoords, value => {
      if (active) setTaskAddress(value)
    })
    return () => {
      active = false
    }
  }, [taskCoords?.lat, taskCoords?.lng, resolveAddressLabel])

  useEffect(() => {
    let active = true
    void resolveAddressLabel(presenceCoords, value => {
      if (active) setPresenceAddress(value)
    })
    return () => {
      active = false
    }
  }, [presenceCoords?.lat, presenceCoords?.lng, resolveAddressLabel])

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

  const clearStartPhotoCaptures = useCallback(() => {
    setStartPhotoCaptures(prev => {
      prev.forEach(item => URL.revokeObjectURL(item.previewUrl))
      return []
    })
  }, [])

  const clearEndPhotoCaptures = useCallback(() => {
    setEndPhotoCaptures(prev => {
      prev.forEach(item => URL.revokeObjectURL(item.previewUrl))
      return []
    })
  }, [])

  const resetEvidenceAndLocation = (options?: { keepStartEvidenceCount?: boolean }) => {
    setCoords(null)
    setGpsStatus("idle")
    setGpsMessage("")
    setStartCameraOpen(false)
    setEndCameraOpen(false)
    setShowShiftSummary(false)
    setSpecialTaskDone(false)
    setStartRecoveryPhoto(null)
    setEndEvidenceUploadError(null)
    setEndShiftError(null)
    clearStartPhotoCaptures()
    clearEndPhotoCaptures()
    setStartAreaKey("")
    setStartAreaDetail("")
    setStartSubareaKey("")
    setEndAreaKey("")
    setEndAreaDetail("")
    setEndSubareaKey("")
    setEndEvidenceUploadedShiftId(null)
    setEndEvidencePhotoCount(0)
    if (!options?.keepStartEvidenceCount) {
      setStartEvidencePhotoCount(0)
    }
  }

  const resetTaskEvidenceCapture = () => {
    setTaskCoords(null)
    setTaskPhotoClose(null)
    setTaskPhotoMid(null)
    setTaskPhotoWide(null)
  }

  const handleSendShiftOtp = async () => {
    const fingerprint = getOrCreateDeviceFingerprint()
    debugLog("otp.send.click", { fingerprint: fingerprint ? `${fingerprint.slice(0, 6)}...` : null })
    setSendingOtp(true)
    try {
      const result = await sendShiftPhoneOtp()
      const maskedPhone = result?.maskedPhone
      const deliveryStatus = result?.deliveryStatus
      const debugCode = result?.debugCode ?? null
      debugLog("otp.send.result", { deliveryStatus, maskedPhone, debugCode })
      setOtpDebugCode(debugCode)
      setOtpDebugMaskedPhone(maskedPhone ?? null)
      setOtpDebugExpiresAt(result?.expiresAt ?? null)
      const deliveryLabel =
        deliveryStatus === "screen" || deliveryStatus === "debug"
          ? t("Codigo visible en pantalla.", "Code visible on screen.")
          : ""
      showToast(
        "success",
        debugCode
          ? t(
              `Codigo OTP listo: ${debugCode}. ${deliveryLabel}`,
              `OTP code ready: ${debugCode}. ${deliveryLabel}`
            )
          : t(
              `Codigo OTP generado. ${deliveryLabel}`,
              `OTP generated. ${deliveryLabel}`
            )
      )
    } catch (error: unknown) {
      debugLog("otp.send.error", { message: extractErrorMessage(error, "otp send failed") })
      showToast("error", extractErrorMessage(error, t("No se pudo enviar OTP.", "Could not send OTP.")))
    } finally {
      setSendingOtp(false)
    }
  }

  const handleCaptureStartPhoto = useCallback(
    (file: Blob | null) => {
      if (!file) return
      if (!isAreaComplete(startAreaKey, startAreaDetail, startSubareaKey)) {
        showToast("info", t("Selecciona el area antes de tomar la foto.", "Select the area before taking the photo."))
        return
      }
      const previewUrl = URL.createObjectURL(file)
      setStartPhotoCaptures(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          file,
          areaKey: startAreaKey,
          areaDetail: startAreaDetail.trim() || undefined,
          subareaKey: startSubareaKey || undefined,
          previewUrl,
        },
      ])
    },
    [isAreaComplete, showToast, startAreaDetail, startAreaKey, startSubareaKey, t]
  )

  const handleCaptureEndPhoto = useCallback(
    (file: Blob | null) => {
      if (!file) return
      if (!isAreaComplete(endAreaKey, endAreaDetail, endSubareaKey)) {
        showToast("info", t("Selecciona el area antes de tomar la foto.", "Select the area before taking the photo."))
        return
      }
      const previewUrl = URL.createObjectURL(file)
      setEndPhotoCaptures(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          file,
          areaKey: endAreaKey,
          areaDetail: endAreaDetail.trim() || undefined,
          subareaKey: endSubareaKey || undefined,
          previewUrl,
        },
      ])
    },
    [endAreaDetail, endAreaKey, endSubareaKey, isAreaComplete, showToast, t]
  )

  const handleRemoveStartPhoto = useCallback((id: string) => {
    setStartPhotoCaptures(prev => {
      const target = prev.find(item => item.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter(item => item.id !== id)
    })
  }, [])

  const handleRemoveEndPhoto = useCallback((id: string) => {
    setEndPhotoCaptures(prev => {
      const target = prev.find(item => item.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter(item => item.id !== id)
    })
  }, [])

  const handleVerifyShiftOtp = async () => {
    if (!otpCode.trim()) {
      showToast("info", t("Ingresa el codigo OTP.", "Enter OTP code."))
      return
    }

    setVerifyingOtp(true)
    try {
      debugLog("otp.verify.click", { codeLength: otpCode.trim().length })
      await verifyShiftPhoneOtp({ code: otpCode })
      setShiftOtpReady(true)
      setOtpVerifiedAt(new Date().toISOString())
      setOtpCode("")
      debugLog("otp.verify.success")
      showToast("success", t("OTP verificado. Ya puedes operar turnos.", "OTP verified. You can now operate shifts."))
    } catch (error: unknown) {
      setShiftOtpReady(false)
      debugLog("otp.verify.error", { message: extractErrorMessage(error, "otp verify failed") })
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
    setOtpDebugCode(null)
    setOtpDebugMaskedPhone(null)
    setOtpDebugExpiresAt(null)
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

      if (startPhotoCaptures.length === 0) {
        throw new Error(t("Debes capturar fotos de ingreso.", "You must capture entry photos."))
      }
      if (!startPhotosReady) {
        throw new Error(t("Selecciona el area y subarea en cada foto de ingreso.", "Select area and subarea for each entry photo."))
      }
      const scheduledShift = currentScheduledShift
      const currentRestaurantId = overrideRestaurantId ?? scheduledShift?.restaurant_id ?? null
      debugLog("shift.start.intent", {
        restaurantId: currentRestaurantId,
        scheduledShiftId: scheduledShift?.id ?? null,
        coords: coords ? { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracyMeters } : null,
        photos: startPhotoCaptures.length,
        otpReady: shiftOtpReady,
      })
      if (!currentRestaurantId) {
        throw new Error(
          t(
            "No hay turno programado disponible o el turno ya vencio.",
            "No scheduled shift is available or the shift already expired."
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
          scheduledShiftId: scheduledShift?.id ?? null,
        })
      )
      startedShiftId = shiftId
      debugLog("shift.start.success", { shiftId })
      if (scheduledShift?.scheduled_end) {
        const scheduledEndMs = new Date(scheduledShift.scheduled_end).getTime()
        setActiveScheduledMeta({
          shiftId,
          scheduledEndMs: Number.isFinite(scheduledEndMs) ? scheduledEndMs : null,
          restaurantId: scheduledShift.restaurant_id,
        })
      } else {
        setActiveScheduledMeta({ shiftId, scheduledEndMs: null, restaurantId: currentRestaurantId })
      }

      const startPhotoCount = startPhotoCaptures.length
      for (const capture of startPhotoCaptures) {
        await uploadShiftEvidence({
          shiftId,
          type: "inicio",
          file: capture.file,
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracyMeters,
          meta: buildEvidenceMeta(capture.areaKey, capture.areaDetail, capture.subareaKey),
        })
      }
      debugLog("shift.start.evidence.success", { shiftId, type: "inicio" })
      setLocalStartEvidenceShiftId(shiftId)
      clearStartPhotoCaptures()
      setStartEvidencePhotoCount(startPhotoCount)

      if (startObservation.trim()) {
        await createShiftIncident(String(shiftId), `[INGRESO] ${startObservation.trim()}`)
      }

      showToast("success", t("Turno iniciado correctamente.", "Shift started successfully."))
      resetEvidenceAndLocation({ keepStartEvidenceCount: true })
      setStartObservation("")
      setStartFitForWork(null)
      setStartHealthDeclaration("")
      setHistoryPage(1)
      await loadEmployeeData(1)
      await loadEmployeeSelfServiceDashboard()
      await loadTasks()
      await loadSupervisorData()
      if (isEmpleado) {
        handleEmployeeView("cleaning")
      }
    } catch (error: unknown) {
      if (startedShiftId) {
        await loadEmployeeData(1)
      }
      if (isConsentPendingError(error)) {
        showToast("error", t("Consentimiento pendiente: acepta terminos de tratamiento de datos para operar turnos.", "Consent pending: accept data processing terms to operate shifts."))
        return
      }
      debugLog("shift.start.error", { message: extractErrorMessage(error, "shift start failed") })
      showToast("error", extractErrorMessage(error, t("No se pudo iniciar el turno.", "Could not start shift.")))
    } finally {
      setProcessing(false)
    }
  }

  const handleEnd = async () => {
    if (!canSubmit || !coords || !activeShift) return
    setProcessing(true)
    setEndShiftError(null)
    debugLog("shift.end.intent", {
      shiftId: activeShift.id,
      coords: { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracyMeters },
      endPhotos: endPhotoCaptures.length,
      endEvidenceUploaded,
      hasStartEvidence,
      earlyEndReasonRequired,
      earlyEndReason: endEarlyReason.trim() ? "set" : "missing",
      otpReady: shiftOtpReady,
    })

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

      if (!endEvidenceUploaded) {
        if (endPhotoCaptures.length === 0) {
          throw new Error(t("Debes capturar fotos de salida.", "You must capture exit photos."))
        }
        if (expectedEndPhotoCount && endPhotoCaptures.length < expectedEndPhotoCount) {
          throw new Error(
            t(
              `Debes tomar al menos ${expectedEndPhotoCount} fotos de salida (las mismas del inicio).`,
              `You must take at least ${expectedEndPhotoCount} exit photos (same as start).`
            )
          )
        }
        if (!endPhotosReady) {
          throw new Error(t("Selecciona el area y subarea en cada foto de salida.", "Select area and subarea for each exit photo."))
        }
        setEndEvidenceUploadError(null)
        try {
          const totalPhotos = endPhotoCaptures.length
          for (const capture of endPhotoCaptures) {
            await uploadShiftEvidence({
              shiftId: Number(activeShift.id),
              type: "fin",
              file: capture.file,
              lat: coords.lat,
              lng: coords.lng,
              accuracy: coords.accuracyMeters,
              meta: buildEvidenceMeta(capture.areaKey, capture.areaDetail, capture.subareaKey),
            })
          }
          debugLog("shift.end.evidence.success", { shiftId: activeShift.id })
          clearEndPhotoCaptures()
          setEndEvidenceUploadedShiftId(activeShift.id)
          setEndEvidencePhotoCount(totalPhotos)
        } catch (error: unknown) {
          const exact = formatErrorDetails(error, t("No se pudo subir la evidencia de salida.", "Could not upload end evidence."))
          setEndEvidenceUploadError(exact)
          debugLog("shift.end.evidence.error", { message: extractErrorMessage(error, "end evidence upload failed") })
          throw error
        }
      }
      debugLog("shift.end.request", { shiftId: activeShift.id })
      await endShift({
        shiftId: activeShift.id,
        lat: coords.lat,
        lng: coords.lng,
        fitForWork: endFitForWork,
        declaration: endHealthDeclaration.trim() || null,
        earlyEndReason: earlyReason || null,
      })
      debugLog("shift.end.success", { shiftId: activeShift.id })

      if (endObservation.trim()) {
        await createShiftIncident(activeShift.id, `[SALIDA] ${endObservation.trim()}`)
      }

      const summaryPhotos = Math.max(endEvidenceCount, endPhotoCaptures.length)
      setShiftSuccess({
        restaurantLabel: activeRestaurantLabel,
        startTime: activeShift.start_time ?? new Date().toISOString(),
        endTime: new Date().toISOString(),
        photos: summaryPhotos,
        completedTasks: completedEmployeeTasks.length,
      })

      showToast("success", t("Turno finalizado correctamente.", "Shift ended successfully."))
      resetEvidenceAndLocation()
      setLocalStartEvidenceShiftId(null)
      writeStartEvidenceCache(null)
      writeEndEvidenceCache(null)
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
      const fallback = t("No se pudo finalizar el turno.", "Could not end shift.")
      const exact = formatErrorDetails(error, fallback)
      const normalized = extractErrorMessage(error, "").toLowerCase()
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status?: number }).status : undefined
      const code =
        typeof (error as { code?: unknown }).code === "string" ? (error as { code?: string }).code : undefined
      debugLog("shift.end.error", { status, code, message: exact })
      if (status === 409 || code === "409" || normalized.includes("409") || normalized.includes("conflict")) {
        setEndShiftError(exact)
        showToast(
          "info",
          t(`Respuesta 409: ${exact}. Actualizando estado...`, `409 response: ${exact}. Refreshing state...`)
        )
        resetEvidenceAndLocation()
        setLocalStartEvidenceShiftId(null)
        writeStartEvidenceCache(null)
        writeEndEvidenceCache(null)
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
        return
      }
      setEndShiftError(exact)
      if (isConsentPendingError(error)) {
        showToast("error", t("Consentimiento pendiente: acepta terminos de tratamiento de datos para operar turnos.", "Consent pending: accept data processing terms to operate shifts."))
        return
      }
      showToast("error", exact)
    } finally {
      setProcessing(false)
    }
  }

  const handleUploadMissingStartEvidence = async () => {
    if (!activeShift) return
    if (!coords || !startRecoveryPhoto) {
      showToast("info", t("Debes capturar GPS y fotos de ingreso.", "You must capture GPS and entry photos."))
      return
    }
    debugLog("shift.start_evidence.recover.intent", {
      shiftId: activeShift.id,
      coords: { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracyMeters },
      hasPhoto: !!startRecoveryPhoto,
      otpReady: shiftOtpReady,
    })
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
        meta: buildEvidenceMeta(startAreaKey, startAreaDetail, startSubareaKey),
      })
      debugLog("shift.start_evidence.recover.success", { shiftId: activeShift.id })
      setLocalStartEvidenceShiftId(activeShift.id)
      setStartEvidencePhotoCount(1)
      setStartRecoveryPhoto(null)
      showToast("success", t("Evidencia de inicio cargada.", "Start evidence uploaded."))
      resetEvidenceAndLocation({ keepStartEvidenceCount: true })
      setHistoryPage(1)
      await loadEmployeeData(1)
      await loadEmployeeSelfServiceDashboard()
    } catch (error: unknown) {
      const message = extractErrorMessage(error, "")
      const normalized = message.toLowerCase()
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status?: number }).status : undefined
      const code =
        typeof (error as { code?: unknown }).code === "string" ? (error as { code?: string }).code : undefined
      if (status === 409 || code === "409" || normalized.includes("409") || normalized.includes("conflict")) {
        // Treat as already registered on backend.
        setLocalStartEvidenceShiftId(activeShift.id)
        setStartEvidencePhotoCount(1)
        setStartRecoveryPhoto(null)
        debugLog("shift.start_evidence.recover.already", { shiftId: activeShift.id })
        showToast(
          "success",
          t("Evidencia de inicio ya estaba registrada.", "Start evidence was already registered.")
        )
        return
      }
      if (normalized.includes("otp")) {
        setShiftOtpReady(false)
        debugLog("shift.start_evidence.recover.otp_error", { shiftId: activeShift.id })
        showToast(
          "error",
          t(
            "OTP invalido o vencido. Verificalo de nuevo para subir la evidencia.",
            "Invalid or expired OTP. Verify again to upload evidence."
          )
        )
        return
      }
      debugLog("shift.start_evidence.recover.error", { message: extractErrorMessage(error, "start evidence upload failed") })
      showToast("error", t("No se pudo subir la evidencia de inicio.", "Could not upload start evidence."))
    } finally {
      setUploadingStartEvidence(false)
    }
  }

  const handleUploadEndEvidence = async () => {
    if (!activeShift) return
    if (!coords) {
      showToast("info", t("Debes capturar la ubicacion GPS.", "You must capture GPS location."))
      return
    }
    if (!shiftOtpReady) {
      showToast("info", t("Debes verificar OTP antes de registrar la salida.", "Verify OTP before registering exit."))
      return
    }
    if (endPhotoCaptures.length === 0) {
      showToast("info", t("Debes capturar fotos de salida.", "You must capture exit photos."))
      return
    }
    if (expectedEndPhotoCount && endPhotoCaptures.length < expectedEndPhotoCount) {
      showToast(
        "info",
        t(
          `Debes tomar al menos ${expectedEndPhotoCount} fotos de salida (las mismas del inicio).`,
          `You must take at least ${expectedEndPhotoCount} exit photos (same as start).`
        )
      )
      return
    }
    if (!endPhotosReady) {
      showToast("info", t("Selecciona el area en cada foto de salida.", "Select the area for each exit photo."))
      return
    }

    setUploadingEndEvidence(true)
    setEndEvidenceUploadError(null)
    try {
      const totalPhotos = endPhotoCaptures.length
      for (const capture of endPhotoCaptures) {
        await uploadShiftEvidence({
          shiftId: Number(activeShift.id),
          type: "fin",
          file: capture.file,
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracyMeters,
          meta: buildEvidenceMeta(capture.areaKey, capture.areaDetail, capture.subareaKey),
        })
      }
      setEndEvidenceUploadedShiftId(activeShift.id)
      setEndEvidencePhotoCount(totalPhotos)
      clearEndPhotoCaptures()
      debugLog("shift.end.evidence.success", { shiftId: activeShift.id })
      showToast("success", t("Fin de tarea registrado.", "Task end registered."))
    } catch (error: unknown) {
      const exact = formatErrorDetails(error, t("No se pudo subir la evidencia de salida.", "Could not upload end evidence."))
      setEndEvidenceUploadError(exact)
      debugLog("shift.end.evidence.error", { message: extractErrorMessage(error, "end evidence upload failed") })
    } finally {
      setUploadingEndEvidence(false)
    }
  }

  const handleStatusChange = async (shiftId: string, status: string) => {
    try {
      debugLog("supervisor.shift.status.intent", { shiftId, status })
      await updateShiftStatus(shiftId, status)
      debugLog("supervisor.shift.status.success", { shiftId, status })
      showToast("success", t(`Turno actualizado a ${status}.`, `Shift updated to ${status}.`))
      await loadSupervisorData()
    } catch (error: unknown) {
      debugLog("supervisor.shift.status.error", { message: extractErrorMessage(error, "status update failed") })
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

  const resetTaskEditState = () => {
    setEditingTaskId(null)
    setEditingTaskTitle("")
    setEditingTaskDescription("")
    setEditingTaskPriority("normal")
    setEditingTaskDueAt("")
  }

  const handleStartEditTask = (task: OperationalTask) => {
    setEditingTaskId(task.id)
    setEditingTaskTitle(task.title ?? "")
    setEditingTaskDescription(task.description ?? "")
    setEditingTaskPriority(task.priority ?? "normal")
    setEditingTaskDueAt(task.due_at ? new Date(task.due_at).toISOString().slice(0, 16) : "")
  }

  const handleSaveTaskEdit = async () => {
    if (!editingTaskId) return
    if (!editingTaskTitle.trim()) {
      showToast("info", t("El titulo es obligatorio.", "Title is required."))
      return
    }

    setSavingTaskEditId(editingTaskId)
    try {
      await updateOperationalTaskDetails({
        taskId: editingTaskId,
        title: editingTaskTitle.trim(),
        description: editingTaskDescription.trim(),
        priority: editingTaskPriority,
        dueAt: editingTaskDueAt ? new Date(editingTaskDueAt).toISOString() : null,
      })
      showToast("success", t("Tarea actualizada.", "Task updated."))
      resetTaskEditState()
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo actualizar la tarea.", "Could not update task.")))
    } finally {
      setSavingTaskEditId(null)
    }
  }

  const handleCloseSupervisorTask = async (taskId: number) => {
    setClosingTaskId(taskId)
    try {
      await closeOperationalTask(taskId)
      showToast("success", t("Tarea cerrada.", "Task closed."))
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo cerrar la tarea.", "Could not close task.")))
    } finally {
      setClosingTaskId(null)
    }
  }

  const handleCancelSupervisorTask = async (taskId: number) => {
    setCancelingTaskId(taskId)
    try {
      await cancelOperationalTask(taskId)
      showToast("success", t("Tarea cancelada.", "Task cancelled."))
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo cancelar la tarea.", "Could not cancel task.")))
    } finally {
      setCancelingTaskId(null)
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

  const resetSupervisionFlow = useCallback(() => {
    setSupervisionStep("start")
    setSupervisionStartPhotos(prev => {
      prev.forEach(photo => URL.revokeObjectURL(photo.previewUrl))
      return []
    })
    setSupervisionEndPhotos(prev => {
      prev.forEach(photo => URL.revokeObjectURL(photo.previewUrl))
      return []
    })
    setSupervisionAreaKey("")
    setSupervisionAreaDetail("")
    setSupervisionSubareaKey("")
    setSupervisionObservation("")
    setPresenceCoords(null)
    setPresencePhoto(null)
    setSupervisionSessionId(crypto.randomUUID())
  }, [])

  const buildSupervisionNote = useCallback(
    (photo: SupervisionPhotoDraft, phase: "start" | "end", observation?: string) => {
      const areaLabel = areaLabelByKey.get(photo.areaKey) ?? photo.areaKey
      const subLabel =
        photo.subareaKey && subareaLabelByArea.get(photo.areaKey)
          ? subareaLabelByArea.get(photo.areaKey)?.get(photo.subareaKey ?? "") ?? photo.subareaKey
          : null
      const payload = {
        session_id: supervisionSessionId,
        phase,
        area_key: photo.areaKey,
        area_label: areaLabel,
        subarea_key: photo.subareaKey ?? null,
        subarea_label: subLabel ?? null,
        area_detail: photo.areaDetail ?? null,
        observation: observation?.trim() || null,
      }
      return JSON.stringify(payload)
    },
    [areaLabelByKey, subareaLabelByArea, supervisionSessionId]
  )

  const handleCaptureSupervisionPhoto = useCallback(
    (blob: Blob | null) => {
      if (!blob) return
      if (!supervisionAreaKey) {
        showToast("info", t("Selecciona un area antes de tomar la foto.", "Select an area before taking the photo."))
        return
      }
      const subareas = subareaOptionsByArea.get(supervisionAreaKey) ?? []
      if (subareas.length > 0 && supervisionAreaKey !== "otro" && !supervisionSubareaKey) {
        showToast("info", t("Selecciona una subarea.", "Select a subarea."))
        return
      }
      if (supervisionAreaKey === "otro" && !supervisionAreaDetail.trim()) {
        showToast("info", t("Describe el area.", "Describe the area."))
        return
      }
      const entry: SupervisionPhotoDraft = {
        id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        file: blob,
        areaKey: supervisionAreaKey,
        areaDetail: supervisionAreaDetail.trim() || undefined,
        subareaKey: supervisionSubareaKey || undefined,
        previewUrl: URL.createObjectURL(blob),
      }
      if (supervisionStep === "start") {
        setSupervisionStartPhotos(prev => [...prev, entry])
      } else if (supervisionStep === "end") {
        setSupervisionEndPhotos(prev => [...prev, entry])
      }
      setSupervisionAreaKey("")
      setSupervisionAreaDetail("")
      setSupervisionSubareaKey("")
    },
    [
      showToast,
      subareaOptionsByArea,
      supervisionAreaDetail,
      supervisionAreaKey,
      supervisionStep,
      supervisionSubareaKey,
      t,
    ]
  )

  const handleRemoveSupervisionPhoto = useCallback((phase: "start" | "end", id: string) => {
    const remove = (items: SupervisionPhotoDraft[]) => {
      const target = items.find(item => item.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return items.filter(item => item.id !== id)
    }
    if (phase === "start") {
      setSupervisionStartPhotos(prev => remove(prev))
    } else {
      setSupervisionEndPhotos(prev => remove(prev))
    }
  }, [])

  const handleRegisterSupervisionStart = async () => {
    if (!presenceRestaurantId) {
      showToast("info", t("Selecciona un restaurante.", "Select a restaurant."))
      return
    }
    if (!presenceCoords) {
      showToast("info", t("Activa el GPS antes de registrar.", "Enable GPS before registering."))
      return
    }
    if (supervisionStartPhotos.length === 0) {
      showToast("info", t("Agrega al menos una foto de ingreso.", "Add at least one entry photo."))
      return
    }
    setSupervisionUploading(true)
    try {
      for (const photo of supervisionStartPhotos) {
        const { filePath, evidenceHash, evidenceMimeType, evidenceSizeBytes } = await uploadEvidence(
          "supervision-start",
          photo.file,
          presenceCoords
        )
        await registerSupervisorPresence({
          restaurantId: presenceRestaurantId,
          phase: "start",
          lat: presenceCoords.lat,
          lng: presenceCoords.lng,
          notes: buildSupervisionNote(photo, "start"),
          evidencePath: filePath,
          evidenceHash,
          evidenceMimeType,
          evidenceSizeBytes,
        })
      }
      setSupervisionStartPhotos(prev => {
        prev.forEach(photo => URL.revokeObjectURL(photo.previewUrl))
        return []
      })
      setSupervisionStep("cleaning")
      showToast("success", t("Inicio de supervision registrado.", "Supervision start recorded."))
      await loadPresenceLogs()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo registrar el inicio.", "Could not register start.")))
    } finally {
      setSupervisionUploading(false)
    }
  }

  const handleRegisterSupervisionEnd = async () => {
    if (!presenceRestaurantId) {
      showToast("info", t("Selecciona un restaurante.", "Select a restaurant."))
      return
    }
    if (!presenceCoords) {
      showToast("info", t("Activa el GPS antes de registrar.", "Enable GPS before registering."))
      return
    }
    if (supervisionEndPhotos.length === 0) {
      showToast("info", t("Agrega al menos una foto de salida.", "Add at least one exit photo."))
      return
    }
    setSupervisionUploading(true)
    try {
      for (const photo of supervisionEndPhotos) {
        const { filePath, evidenceHash, evidenceMimeType, evidenceSizeBytes } = await uploadEvidence(
          "supervision-end",
          photo.file,
          presenceCoords
        )
        await registerSupervisorPresence({
          restaurantId: presenceRestaurantId,
          phase: "end",
          lat: presenceCoords.lat,
          lng: presenceCoords.lng,
          notes: buildSupervisionNote(photo, "end", supervisionObservation),
          evidencePath: filePath,
          evidenceHash,
          evidenceMimeType,
          evidenceSizeBytes,
        })
      }
      setSupervisionEndPhotos(prev => {
        prev.forEach(photo => URL.revokeObjectURL(photo.previewUrl))
        return []
      })
      showToast("success", t("Supervision finalizada.", "Supervision completed."))
      resetSupervisionFlow()
      await loadPresenceLogs()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo finalizar la supervision.", "Could not finish supervision.")))
    } finally {
      setSupervisionUploading(false)
    }
  }

  const setSupervisorScreenWithHistory = useCallback(
    (next: typeof supervisorScreen) => {
      setSupervisorScreenHistory(prev => {
        const last = prev[prev.length - 1]
        if (last === next) return prev
        return [...prev, next]
      })
      setSupervisorScreen(next)
    },
    []
  )

  const handleSupervisorBack = useCallback(() => {
    setSupervisorScreenHistory(prev => {
      if (prev.length <= 1) return prev
      const next = prev.slice(0, -1)
      setSupervisorScreen(next[next.length - 1] ?? "home")
      return next
    })
  }, [])

  useEffect(() => {
    if (!canOperateSupervisor) return
    const supervisorParam = searchParams.get("supervisor")

    if (supervisorParam === "presence") {
      if (supervisorScreen !== "presence") {
        setSupervisorScreenWithHistory("presence")
      }
      return
    }

    if (supervisorParam === "turnos") {
      if (supervisorScreen !== "turnos") {
        setSupervisorScreenWithHistory("turnos")
      }
      return
    }

  }, [canOperateSupervisor, searchParams, setSupervisorScreenWithHistory, supervisorScreen])

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

  const handleImportSupervisorScheduleFile = async (file: File | null) => {
    if (!file) return
    if (!supervisorScheduleEmployeeId || !supervisorScheduleRestaurantId) {
      showToast("info", t("Selecciona empleado y restaurante antes de importar.", "Select employee and restaurant before importing."))
      return
    }

    try {
      const XLSX = (await import("xlsx")) as typeof import("xlsx")
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: "array", cellDates: true })
      const sheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })

      const normalizeKey = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, "")
      const startKeys = new Set(["scheduledstart", "start", "inicio", "fechainicio", "starttime", "iniciohora"])
      const endKeys = new Set(["scheduledend", "end", "fin", "fechafin", "endtime", "finhora"])

      const parseDateValue = (value: unknown) => {
        if (!value) return ""
        if (value instanceof Date) return value.toISOString().slice(0, 16)
        if (typeof value === "number") {
          const parsed = XLSX.SSF.parse_date_code(value)
          if (!parsed) return ""
          const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S || 0))
          return date.toISOString().slice(0, 16)
        }
        if (typeof value === "string") {
          const trimmed = value.trim()
          if (!trimmed) return ""
          const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T")
          const date = new Date(normalized)
          if (!Number.isFinite(date.getTime())) return ""
          return date.toISOString().slice(0, 16)
        }
        return ""
      }

      const blocks = rows
        .map((row, index) => {
          const startValue = Object.entries(row).find(([key]) => startKeys.has(normalizeKey(key)))
          const endValue = Object.entries(row).find(([key]) => endKeys.has(normalizeKey(key)))
          const start = parseDateValue(startValue?.[1])
          const end = parseDateValue(endValue?.[1])
          return {
            id: Date.now() + index + Math.floor(Math.random() * 1000),
            start,
            end,
          }
        })
        .filter(item => item.start && item.end)

      if (blocks.length === 0) {
        showToast(
          "info",
          t(
            "No se encontraron filas validas. Usa columnas start/end o scheduled_start/scheduled_end.",
            "No valid rows found. Use start/end or scheduled_start/scheduled_end columns."
          )
        )
        return
      }

      setSupervisorScheduleBlocks(blocks)
      showToast("success", t(`${blocks.length} bloque(s) importados.`, `${blocks.length} block(s) imported.`))
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo importar el archivo.", "Could not import file.")))
    }
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

  const handleScheduleSupervisorShiftSingle = async () => {
    if (!supervisorScheduleEmployeeId || !supervisorScheduleRestaurantId) {
      showToast("info", t("Selecciona empleado y restaurante.", "Select employee and restaurant."))
      return
    }
    if (!supervisorBulkRangeStart || !supervisorBulkStartTime || !supervisorBulkEndTime) {
      showToast("info", t("Selecciona fecha y horario.", "Select date and schedule."))
      return
    }

    const startIso = new Date(`${supervisorBulkRangeStart}T${supervisorBulkStartTime}`).toISOString()
    const endIso = new Date(`${supervisorBulkRangeStart}T${supervisorBulkEndTime}`).toISOString()

    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      showToast("info", t("La hora fin debe ser posterior a la hora inicio.", "End time must be after start time."))
      return
    }

    setSupervisorBulkScheduling(true)
    try {
      await assignScheduledShiftsBulk({
        employeeId: supervisorScheduleEmployeeId,
        restaurantId: String(supervisorScheduleRestaurantId),
        blocks: [{ scheduledStartIso: startIso, scheduledEndIso: endIso }],
        notes: supervisorScheduleNotes.trim() || undefined,
      })
      showToast("success", t("Turno programado exitosamente.", "Shift scheduled successfully."))
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, t("No se pudo programar el turno.", "Could not schedule shift.")))
    } finally {
      setSupervisorBulkScheduling(false)
    }
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

  const otpPanel = !shiftOtpReady && (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="bg-gradient-to-br from-indigo-500 to-blue-600 px-6 py-5 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">
          {t("Seguridad OTP", "OTP security")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant={shiftOtpReady ? "success" : "warning"}>
            {shiftOtpReady ? t("OTP verificado", "OTP verified") : t("OTP pendiente", "OTP pending")}
          </Badge>
          {otpVerifiedAt && (
            <span className="text-xs text-indigo-100">
              {t("Validado", "Verified")}: {formatDateTime(otpVerifiedAt)}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-indigo-100">
          {activeShift
            ? t(
                "Completa el codigo para finalizar el turno.",
                "Complete the code to end the shift."
              )
            : t(
                "Completa el codigo para iniciar el turno.",
                "Complete the code to start the shift."
              )}
        </p>
      </div>

      <div className="space-y-4 px-6 py-5 text-sm">
        {otpDebugCode && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              {t("Codigo en pantalla", "On-screen code")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="rounded-2xl bg-white px-3 py-2 font-mono text-lg font-bold text-emerald-900">
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
            <div className="mt-2 text-[11px] text-emerald-700">
              {otpDebugMaskedPhone ? `${t("Referencia", "Reference")}: ${otpDebugMaskedPhone}. ` : ""}
              {otpDebugExpiresAt ? `${t("Expira", "Expires")}: ${formatDateTime(otpDebugExpiresAt)}` : ""}
            </div>
          </div>
        )}

        <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
          <input
            value={otpCode}
            onChange={event => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            className="h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-400"
            placeholder={t("Ingresa el codigo OTP", "Enter OTP code")}
          />
          <Button size="sm" variant="primary" onClick={() => void handleVerifyShiftOtp()} disabled={verifyingOtp}>
            {verifyingOtp ? t("Verificando...", "Verifying...") : t("Verificar OTP", "Verify OTP")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => void handleSendShiftOtp()} disabled={sendingOtp}>
            {sendingOtp ? t("Generando codigo...", "Generating code...") : t("Generar codigo", "Generate code")}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleResetShiftOtp}>
            {t("Reiniciar OTP", "Reset OTP")}
          </Button>
        </div>
      </div>
    </div>
  )
  const supervisorOtpHint =
    canOperateSupervisor && !canOperateShift && !shiftOtpReady ? (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">
            {t("OTP pendiente para aprobaciones.", "OTP required for approvals.")}
          </p>
          <Button size="sm" variant="secondary" onClick={() => setSupervisorScreenWithHistory("otp")}>
            {t("Verificar OTP", "Verify OTP")}
          </Button>
        </div>
        <p className="mt-2 text-xs text-amber-800">
          {t(
            "Completa el codigo antes de aprobar/rechazar turnos o registrar incidencias.",
            "Complete the code before approving/rejecting shifts or logging incidents."
          )}
        </p>
      </div>
    ) : null

  const homeRoute = isSupervisora ? "/shifts" : "/dashboard"


  return (
    <ProtectedRoute>
      <div className="space-y-5">
        {shiftSuccess && (
          <div className={`success-screen active ${manrope.className}`}>
            <div className="success-icon">✓</div>
            <h2>{t("¡Turno Completado!", "Shift completed!")}</h2>
            <p>{t("Su turno ha sido finalizado exitosamente. Todas las evidencias han sido guardadas.", "Your shift was completed successfully. All evidence has been saved.")}</p>
            <div className="success-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShiftSuccess(null)
                  router.push(homeRoute)
                }}
              >
                {t("Ir al Inicio", "Go to Home")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setShiftSuccess(null)
                  router.push("/shifts?view=profile")
                }}
              >
                {t("Ver Perfil", "View profile")}
              </button>
            </div>
          </div>
        )}
        {canOperateShift && (
          <section className={`space-y-5 ${manrope.className}`}>
            {otpPanel}
            {isEmpleado && (
              <div className={`space-y-6 ${manrope.className}`}>
                {isEmployeeStartInfoStage && !activeShift && (
                  <div className="space-y-5">
                    <div className="page-title">
                      <button
                        type="button"
                        className="header-btn"
                        onClick={() => router.push("/dashboard")}
                        aria-label={t("Volver", "Back")}
                      >
                        ←
                      </button>
                      {t("Iniciar Turno", "Start shift")}
                    </div>

                    <div className="gps-verification">
                      <div className="info-icon" style={{ margin: "0 auto 10px" }}>
                        📍
                      </div>
                      <h4>{t("Verificación de Ubicación", "Location verification")}</h4>
                      <div className={`gps-status ${gpsStatus === "valid" ? "valid" : "invalid"}`}>
                        <span>{gpsStatus === "checking" ? "⏳" : gpsStatus === "valid" ? "✅" : "❌"}</span>
                        <span>{gpsMessage || t("Verificando GPS...", "Checking GPS...")}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={verifyEmployeeGps}
                        style={{ marginTop: "15px" }}
                      >
                        {gpsStatus === "checking"
                          ? t("Verificando...", "Verifying...")
                          : t("Verificar Ubicación", "Verify location")}
                      </button>
                    </div>

                    <div className="checkbox-wrapper">
                      <input
                        type="checkbox"
                        id="healthCheck"
                        checked={startFitForWork === true}
                        onChange={event => {
                          const checked = event.target.checked
                          setStartFitForWork(checked ? true : null)
                          if (!checked) setStartHealthDeclaration("")
                        }}
                      />
                      <label htmlFor="healthCheck">
                        <strong>{t("Certificado de Actitud", "Fitness certificate")}</strong>
                        <br />
                        <small>
                          {t(
                            "Confirmo que me encuentro en perfecto estado de salud para iniciar mis labores.",
                            "I confirm I am in good health to start my shift."
                          )}
                        </small>
                      </label>
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleEmployeeView("start-evidence")}
                      disabled={!canContinueToPhotos}
                    >
                      {t("Continuar a Fotos", "Continue to photos")} <span>→</span>
                    </button>
                  </div>
                )}

                {isEmployeeStartEvidenceStage && !activeShift && (
                  <div className="space-y-5">
                    <div className="page-title">
                      <button
                        type="button"
                        className="header-btn"
                        onClick={() => handleEmployeeView("start")}
                        aria-label={t("Volver", "Back")}
                      >
                        ←
                      </button>
                      {t("Fotos de Inicio", "Start photos")}
                    </div>

                    <div className="card">
                      <div className="card-header">
                        <div>
                          <div className="card-title">{t("Áreas a Fotografiar", "Areas to photograph")}</div>
                          <div className="card-subtitle">
                            {t("Tome fotos del estado inicial de cada área", "Take photos of each area before cleaning")}
                          </div>
                        </div>
                      </div>

                      <div className="form-row two-col">
                        <div className="form-group">
                          <label>{t("Área", "Area")}</label>
                          <select
                            value={startAreaKey}
                            onChange={event => {
                              const value = event.target.value
                              setStartAreaKey(value)
                              setStartSubareaKey("")
                              if (value !== "otro") setStartAreaDetail("")
                            }}
                          >
                            <option value="">{t("Selecciona un área", "Select an area")}</option>
                            {shiftAreaOptions.map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group">
                          <label>{t("Subárea", "Subarea")}</label>
                          <select
                            value={startSubareaKey}
                            onChange={event => setStartSubareaKey(event.target.value)}
                            disabled={!startAreaKey || startAreaKey === "otro" || (subareaOptionsByArea.get(startAreaKey) ?? []).length === 0}
                          >
                            <option value="">{t("Selecciona una subárea", "Select a subarea")}</option>
                            {(subareaOptionsByArea.get(startAreaKey) ?? []).map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {startAreaKey === "otro" && (
                        <div className="form-group">
                          <label>{t("Detalle del área", "Area detail")}</label>
                          <input
                            value={startAreaDetail}
                            onChange={event => setStartAreaDetail(event.target.value)}
                            placeholder={t("Describe el área", "Describe the area")}
                          />
                        </div>
                      )}

                      <div className="photo-grid">
                        {startPhotoCaptures.map(item => (
                          <div key={item.id} className="photo-slot has-image">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.previewUrl} alt={t("Foto", "Photo")} />
                            <button
                              type="button"
                              className="remove-btn"
                              onClick={() => handleRemoveStartPhoto(item.id)}
                            >
                              ×
                            </button>
                            <label>{getAreaLabel(item.areaKey, item.areaDetail, item.subareaKey)}</label>
                          </div>
                        ))}
                        <div
                          className="photo-slot"
                          role="button"
                          tabIndex={0}
                          onClick={() => setStartCameraOpen(true)}
                          onKeyDown={event => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              setStartCameraOpen(true)
                            }
                          }}
                        >
                          <span style={{ fontSize: "32px", color: "var(--gray)" }}>📷</span>
                          <label>{t("Agregar foto", "Add photo")}</label>
                        </div>
                      </div>

                      {startCameraOpen && (
                        <div className="space-y-3">
                          <CameraCapture
                            onCapture={file => {
                              handleCaptureStartPhoto(file)
                              if (file) setStartCameraOpen(false)
                            }}
                            overlayLines={startOverlayLines}
                          />
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setStartCameraOpen(false)}
                          >
                            {t("Cerrar cámara", "Close camera")}
                          </button>
                        </div>
                      )}

                      <div className="progress-container">
                        <div className="progress-bar">
                          <div className="progress-fill" style={{ width: `${startPhotoProgress}%` }} />
                        </div>
                        <p style={{ textAlign: "center", marginTop: "10px", fontSize: "14px", color: "var(--gray)" }}>
                          {startPhotoCaptures.length} {t("de", "of")} {startPhotoTarget} {t("fotos completadas", "photos completed")}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={() => void handleStart(isSupervisora ? expectedRestaurantId : undefined)}
                      disabled={!canSubmit}
                    >
                      {processing ? t("Almacenando datos...", "Saving data...") : t("Iniciar Limpieza", "Start cleaning")}
                    </button>

                    {submitBlockers.length > 0 && (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-500">
                        {submitBlockers.map(item => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {isEmployeeProfileStage && (
                  <div className="space-y-5">
                    <div className="profile-header">
                      <div className="profile-avatar">{profileInitials}</div>
                      <div className="profile-name">{displayName}</div>
                      <div className="profile-role">{t("Empleado de Limpieza", "Cleaning staff")}</div>
                    </div>

                    <div className="stats-grid">
                      <div className="stat-card">
                        <div className="stat-value">{monthHoursValue}h</div>
                        <div className="stat-label">{t("Horas este mes", "Hours this month")}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-value">{history.length}</div>
                        <div className="stat-label">{t("Turnos realizados", "Completed shifts")}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-value">{upcomingShiftsCount}</div>
                        <div className="stat-label">{t("Turnos próximos", "Upcoming shifts")}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-value">{pendingTasksCount}</div>
                        <div className="stat-label">{t("Tareas especiales", "Special tasks")}</div>
                      </div>
                    </div>

                    <div className="card">
                      <div className="card-header">
                        <div className="card-title">{t("Información de Contacto", "Contact info")}</div>
                      </div>
                      <div className="info-item">
                        <div className="info-icon">✉️</div>
                        <div>
                          <label>{t("Correo", "Email")}</label>
                          <span className="info-value">{user?.email ?? t("Sin correo", "No email")}</span>
                        </div>
                      </div>
                      <div className="info-item">
                        <div className="info-icon">📞</div>
                        <div>
                          <label>{t("Teléfono", "Phone")}</label>
                          <span className="info-value">{profilePhone}</span>
                        </div>
                      </div>
                    </div>

                    <div className="card">
                      <div className="card-header">
                        <div className="card-title">{t("Tareas Especiales", "Special tasks")}</div>
                      </div>
                      {pendingSpecialTasks.length === 0 ? (
                        <p className="text-sm text-slate-500">
                          {t("No hay tareas especiales pendientes.", "No special tasks pending.")}
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {pendingSpecialTasks.map(task => (
                            <div key={task.id} className="task-card">
                              <h4>⭐ {task.title ?? t("Tarea asignada", "Assigned task")}</h4>
                              <p>{task.status ?? t("Pendiente", "Pending")}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {isEmployeeProfileStage && loadingData ? <Skeleton className="h-24" /> : null}

                {isEmployeeEndStage && activeShift && (
                  <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {t("Turno en curso desde", "Shift in progress since")}{" "}
                        <b>{formatDateTime(activeShift.start_time)}</b>
                      </span>
                      <Badge variant="success">{t("En curso", "In progress")}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-emerald-900">
                      {t("Evidencia inicio", "Start evidence")}: {hasStartEvidence ? "OK" : t("Pendiente", "Pending")}
                    </p>
                  </div>
                )}

                {isEmployeeStartEvidenceStage && activeShift && !hasStartEvidence && (
                  <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                    <p className="text-base font-semibold">
                      {t("Evidencia de inicio pendiente", "Start evidence pending")}
                    </p>
                    <p className="mt-1 text-xs text-amber-800">
                      {t("Sube la foto de inicio para poder continuar.", "Upload the start photo to continue.")}
                    </p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold text-amber-800">{t("Ubicacion actual", "Current location")}</p>
                        <div className="mt-2">
                          <GPSGuard onLocation={setCoords} />
                        </div>
                      </div>
                      <div className="space-y-3">
                        <label className="text-xs font-medium text-amber-800">
                          {t("Area", "Area")}
                        </label>
                        <select
                          value={startAreaKey}
                          onChange={event => {
                            const value = event.target.value
                            setStartAreaKey(value)
                            setStartSubareaKey("")
                            if (value !== "otro") setStartAreaDetail("")
                          }}
                          className="w-full rounded-2xl border-2 border-amber-200 bg-white px-3 py-2 text-sm"
                        >
                          <option value="">{t("Selecciona un area", "Select an area")}</option>
                          {shiftAreaOptions.map(option => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {startAreaKey === "otro" && (
                          <input
                            value={startAreaDetail}
                            onChange={event => setStartAreaDetail(event.target.value)}
                            className="w-full rounded-2xl border-2 border-amber-200 bg-white px-3 py-2 text-sm"
                            placeholder={t("Describe el area", "Describe the area")}
                          />
                        )}
                        {startAreaKey && startAreaKey !== "otro" && (
                          <select
                            value={startSubareaKey}
                            onChange={event => setStartSubareaKey(event.target.value)}
                            className="w-full rounded-2xl border-2 border-amber-200 bg-white px-3 py-2 text-sm"
                          >
                            <option value="">{t("Selecciona una subarea", "Select a subarea")}</option>
                            {(subareaOptionsByArea.get(startAreaKey) ?? []).map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        )}
                        <CameraCapture
                          onCapture={file => {
                            if (!isAreaComplete(startAreaKey, startAreaDetail, startSubareaKey)) {
                              showToast(
                                "info",
                                t("Selecciona el area antes de tomar la foto.", "Select the area before taking the photo.")
                              )
                              return
                            }
                            setStartRecoveryPhoto(file)
                          }}
                          overlayLines={startOverlayLines}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-amber-800">
                      <span>{t("GPS", "GPS")}: {coords ? t("Listo", "Ready") : t("Pendiente", "Pending")}</span>
                      <span>
                        {t("Foto de inicio", "Start photo")}: {startRecoveryPhoto ? t("Lista", "Ready") : t("Pendiente", "Pending")}
                      </span>
                    </div>
                    <div className="mt-3">
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
                )}

                {isEmployeeCleaningStage && (
                  <div className="space-y-5">
                    <div className="page-title">{t("Turno en Progreso", "Shift in progress")}</div>

                    <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
                      <div className="shift-active-indicator">
                        <div className="pulse-dot" />
                        <span>{t("TURNO ACTIVO", "SHIFT ACTIVE")}</span>
                      </div>

                      <div className="timer-display">{formatElapsed(elapsedShiftMs)}</div>

                      <div className="alert alert-warning" style={{ margin: "20px 0" }}>
                        <span>⚠️</span>
                        <div>
                          <strong>{t("No cierre la aplicación", "Do not close the app")}</strong>
                          <br />
                          {t("Mantenga la app abierta mientras realiza la limpieza.", "Keep the app open while cleaning.")}
                        </div>
                      </div>

                      <div className="info-item" style={{ marginBottom: "20px" }}>
                        <div className="info-icon">🏬</div>
                        <div>
                          <label>{t("Restaurante", "Restaurant")}</label>
                          <span className="info-value">{activeRestaurantLabel}</span>
                        </div>
                      </div>

                      <div className="progress-container">
                        <div className="progress-bar">
                          <div className="progress-fill" style={{ width: "100%" }} />
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn-large btn-success"
                      onClick={() => {
                        setCleaningMode(false)
                        handleEmployeeView("end")
                      }}
                    >
                      {t("He Terminado la Limpieza", "I finished cleaning")}
                    </button>
                  </div>
                )}

                {isEmployeeEndStage && (
                  <div id="shift-end" className="space-y-5">
                    {!showShiftSummary ? (
                      <>
                        <div className="page-title">
                          <button
                            type="button"
                            className="header-btn"
                            onClick={() => {
                              setCleaningMode(true)
                              handleEmployeeView("cleaning")
                            }}
                            aria-label={t("Volver", "Back")}
                          >
                            ←
                          </button>
                          {t("Finalizar Turno", "End shift")}
                        </div>

                        <div className="card">
                          <div className="card-header">
                            <div>
                              <div className="card-title">{t("Fotos de Finalización", "End photos")}</div>
                              <div className="card-subtitle">
                                {t("Tome fotos del estado final de cada área", "Take photos of each area after cleaning")}
                              </div>
                            </div>
                          </div>

                          <div className="form-row two-col">
                            <div className="form-group">
                              <label>{t("Área", "Area")}</label>
                              <select
                                value={endAreaKey}
                                onChange={event => {
                                  const value = event.target.value
                                  setEndAreaKey(value)
                                  setEndSubareaKey("")
                                  if (value !== "otro") setEndAreaDetail("")
                                }}
                              >
                                <option value="">{t("Selecciona un área", "Select an area")}</option>
                                {shiftAreaOptions.map(option => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="form-group">
                              <label>{t("Subárea", "Subarea")}</label>
                              <select
                                value={endSubareaKey}
                                onChange={event => setEndSubareaKey(event.target.value)}
                                disabled={!endAreaKey || endAreaKey === "otro" || (subareaOptionsByArea.get(endAreaKey) ?? []).length === 0}
                              >
                                <option value="">{t("Selecciona una subárea", "Select a subarea")}</option>
                                {(subareaOptionsByArea.get(endAreaKey) ?? []).map(option => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {endAreaKey === "otro" && (
                            <div className="form-group">
                              <label>{t("Detalle del área", "Area detail")}</label>
                              <input
                                value={endAreaDetail}
                                onChange={event => setEndAreaDetail(event.target.value)}
                                placeholder={t("Describe el área", "Describe the area")}
                              />
                            </div>
                          )}

                          <div className="photo-grid">
                            {endPhotoCaptures.map(item => (
                              <div key={item.id} className="photo-slot has-image">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={item.previewUrl} alt={t("Foto", "Photo")} />
                                <button
                                  type="button"
                                  className="remove-btn"
                                  onClick={() => handleRemoveEndPhoto(item.id)}
                                >
                                  ×
                                </button>
                                <label>{getAreaLabel(item.areaKey, item.areaDetail, item.subareaKey)}</label>
                              </div>
                            ))}
                            <div
                              className="photo-slot"
                              role="button"
                              tabIndex={0}
                              onClick={() => setEndCameraOpen(true)}
                              onKeyDown={event => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault()
                                  setEndCameraOpen(true)
                                }
                              }}
                            >
                              <span style={{ fontSize: "32px", color: "var(--gray)" }}>📷</span>
                              <label>{t("Agregar foto", "Add photo")}</label>
                            </div>
                          </div>

                          {endCameraOpen && (
                            <div className="space-y-3">
                              <CameraCapture
                                onCapture={file => {
                                  handleCaptureEndPhoto(file)
                                  if (file) setEndCameraOpen(false)
                                }}
                                overlayLines={endOverlayLines}
                              />
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setEndCameraOpen(false)}
                              >
                                {t("Cerrar cámara", "Close camera")}
                              </button>
                            </div>
                          )}

                          {expectedEndPhotoCount && (
                            <p className="card-subtitle">
                              {t(
                                `Debes tomar al menos ${expectedEndPhotoCount} fotos de salida.`,
                                `You must capture at least ${expectedEndPhotoCount} end photos.`
                              )}
                            </p>
                          )}

                          {!endEvidenceUploaded ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => void handleUploadEndEvidence()}
                              disabled={uploadingEndEvidence || !coords || !endPhotosReady || !endPhotosMeetExpected}
                            >
                              {uploadingEndEvidence
                                ? t("Almacenando datos...", "Saving data...")
                                : t("Registrar fin de la tarea", "Register task end")}
                            </button>
                          ) : (
                            <div className="alert alert-success">
                              <span>✅</span>
                              <span>{t("Fin de tarea registrado", "Task end registered")}</span>
                            </div>
                          )}

                          {endEvidenceUploadError && (
                            <div className="alert alert-error">
                              <span>⚠️</span>
                              <span>{endEvidenceUploadError}</span>
                            </div>
                          )}
                        </div>

                        <div className="card">
                          <div className="card-header">
                            <div className="card-title">{t("Tarea Especial", "Special task")}</div>
                          </div>
                          <div className="checkbox-wrapper">
                            <input
                              type="checkbox"
                              id="specialTaskDone"
                              checked={specialTaskDone}
                              onChange={event => setSpecialTaskDone(event.target.checked)}
                            />
                            <label htmlFor="specialTaskDone">
                              {t("¿Completó la tarea especial asignada?", "Did you complete the special task?")}
                            </label>
                          </div>
                          <div className="form-group" style={{ marginTop: "15px" }}>
                            <label>{t("Observaciones de avance", "Progress notes")}</label>
                            <textarea
                              value={endObservation}
                              onChange={event => setEndObservation(event.target.value)}
                              placeholder={t("Describa el avance o estado de la tarea...", "Describe progress or status...")}
                            />
                          </div>
                        </div>

                        {earlyEndReasonRequired && (
                          <div className="card">
                            <div className="card-header">
                              <div className="card-title">{t("Motivo de salida temprana", "Early end reason")}</div>
                            </div>
                            <div className="form-group">
                              <label>{t("Detalle", "Details")}</label>
                              <textarea
                                rows={2}
                                value={endEarlyReason}
                                onChange={event => setEndEarlyReason(event.target.value)}
                                placeholder={t("Ej: Terminé tareas antes de la hora.", "Example: Finished tasks early.")}
                              />
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          className="btn btn-success"
                          onClick={() => setShowShiftSummary(true)}
                          disabled={!endEvidenceUploaded}
                        >
                          {t("Ver Resumen y Finalizar", "View summary and finish")}
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="page-title">
                          <button
                            type="button"
                            className="header-btn"
                            onClick={() => setShowShiftSummary(false)}
                            aria-label={t("Volver", "Back")}
                          >
                            ←
                          </button>
                          {t("Resumen del Turno", "Shift summary")}
                        </div>

                        <div className="card">
                          <div className="stats-grid">
                            <div className="stat-card">
                              <div className="stat-value">{summaryDurationLabel}</div>
                              <div className="stat-label">{t("Duración", "Duration")}</div>
                            </div>
                            <div className="stat-card">
                              <div className="stat-value">{endEvidenceCount}</div>
                              <div className="stat-label">{t("Fotos", "Photos")}</div>
                            </div>
                          </div>

                          <div className="info-item">
                            <div className="info-icon">🏬</div>
                            <div>
                              <label>{t("Restaurante", "Restaurant")}</label>
                              <span className="info-value">{activeRestaurantLabel}</span>
                            </div>
                          </div>

                          <div className="info-item">
                            <div className="info-icon">⏰</div>
                            <div>
                              <label>{t("Horario", "Schedule")}</label>
                              <span className="info-value">{summaryScheduleLabel}</span>
                            </div>
                          </div>

                          <div className="info-item">
                            <div className="info-icon">📅</div>
                            <div>
                              <label>{t("Fecha", "Date")}</label>
                              <span className="info-value">{summaryDateLabel}</span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn-large btn-success"
                          onClick={handleEnd}
                          disabled={!canSubmit}
                        >
                          {processing ? t("Almacenando datos...", "Saving data...") : t("Confirmar y Finalizar Turno", "Confirm and finish shift")}
                        </button>

                        {endShiftError && (
                          <div className="alert alert-error">
                            <span>⚠️</span>
                            <span>{endShiftError}</span>
                          </div>
                        )}

                        {submitBlockers.length > 0 && (
                          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-500">
                            {submitBlockers.map(item => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                )}

                {isEmployeeEndStage && activeShift && pendingEmployeeTasks.length > 0 && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    <p className="font-semibold">
                      {t("Alerta operativa: tienes", "Operational alert: you have")} {pendingEmployeeTasks.length} {t("tarea(s) asignadas por supervision.", "task(s) assigned by supervisor.")}
                    </p>
                    <p className="mt-1 text-amber-800">
                      {t("Cierra cada tarea con la evidencia requerida.", "Close each task with the required evidence.")}
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
              </div>
            )}

            {!isEmpleado && (
              <Card
                title={
                  activeShift
                    ? t("Finalizar turno activo", "End active shift")
                    : t("Iniciar turno", "Start shift")
                }
              >
              {!activeShift ? (
                <div id="shift-end" className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
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
                      <p className="text-xs font-semibold text-slate-700">{t("Fotos de ingreso", "Entry photos")}</p>
                      <div className="mt-2 space-y-2">
                        <label className="text-xs font-medium text-slate-600">
                          {t("Area", "Area")}
                        </label>
                        <select
                          value={startAreaKey}
                          onChange={event => {
                            const value = event.target.value
                            setStartAreaKey(value)
                            setStartSubareaKey("")
                            if (value !== "otro") setStartAreaDetail("")
                          }}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="">{t("Selecciona un area", "Select an area")}</option>
                          {shiftAreaOptions.map(option => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {startAreaKey === "otro" && (
                          <input
                            value={startAreaDetail}
                            onChange={event => setStartAreaDetail(event.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder={t("Describe el area", "Describe the area")}
                          />
                        )}
                        {startAreaKey && startAreaKey !== "otro" && (
                          <select
                            value={startSubareaKey}
                            onChange={event => setStartSubareaKey(event.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="">{t("Selecciona una subarea", "Select a subarea")}</option>
                            {(subareaOptionsByArea.get(startAreaKey) ?? []).map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        )}
                        <CameraCapture onCapture={handleCaptureStartPhoto} overlayLines={startOverlayLines} />
                        {startPhotoCaptures.length > 0 && (
                          <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                            <p className="font-semibold text-slate-700">
                              {t("Fotos capturadas", "Captured photos")}: {startPhotoCaptures.length}
                            </p>
                            {startPhotoCaptures.map((item, index) => (
                              <div key={item.id} className="flex items-center justify-between gap-2">
                                <div>
                                  <p className="font-medium text-slate-700">
                                    {t("Foto", "Photo")} #{index + 1}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    {getAreaLabel(item.areaKey, item.areaDetail, item.subareaKey)}
                                  </p>
                                </div>
                                <Button size="sm" variant="ghost" onClick={() => handleRemoveStartPhoto(item.id)}>
                                  {t("Quitar", "Remove")}
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : !hasStartEvidence ? (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">
                    {t("Evidencia de inicio pendiente", "Start evidence pending")}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    {t(
                      "Sube la foto de inicio para poder continuar con el cierre.",
                      "Upload the start photo to continue with shift closing."
                    )}
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold text-amber-800">{t("Ubicacion actual", "Current location")}</p>
                      <div className="mt-2">
                        <GPSGuard onLocation={setCoords} />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-amber-800">{t("Foto de inicio", "Start photo")}</p>
                      <div className="mt-2 space-y-2">
                        <label className="text-xs font-medium text-amber-800">
                          {t("Area", "Area")}
                        </label>
                        <select
                          value={startAreaKey}
                          onChange={event => {
                            const value = event.target.value
                            setStartAreaKey(value)
                            setStartSubareaKey("")
                            if (value !== "otro") setStartAreaDetail("")
                          }}
                          className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
                        >
                          <option value="">{t("Selecciona un area", "Select an area")}</option>
                          {shiftAreaOptions.map(option => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {startAreaKey === "otro" && (
                          <input
                            value={startAreaDetail}
                            onChange={event => setStartAreaDetail(event.target.value)}
                            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
                            placeholder={t("Describe el area", "Describe the area")}
                          />
                        )}
                        {startAreaKey && startAreaKey !== "otro" && (
                          <select
                            value={startSubareaKey}
                            onChange={event => setStartSubareaKey(event.target.value)}
                            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
                          >
                            <option value="">{t("Selecciona una subarea", "Select a subarea")}</option>
                            {(subareaOptionsByArea.get(startAreaKey) ?? []).map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        )}
                        <CameraCapture
                          onCapture={file => {
                            if (!isAreaComplete(startAreaKey, startAreaDetail, startSubareaKey)) {
                              showToast(
                                "info",
                                t("Selecciona el area antes de tomar la foto.", "Select the area before taking the photo.")
                              )
                              return
                            }
                            setStartRecoveryPhoto(file)
                          }}
                          overlayLines={startOverlayLines}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-amber-800">
                    <span>{t("GPS", "GPS")}: {coords ? t("Listo", "Ready") : t("Pendiente", "Pending")}</span>
                    <span>{t("Foto de inicio", "Start photo")}: {startRecoveryPhoto ? t("Lista", "Ready") : t("Pendiente", "Pending")}</span>
                  </div>
                  <div className="mt-3">
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
              ) : (
                <>
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
                      <p className="text-xs font-semibold text-slate-700">{t("Fotos de salida", "Exit photos")}</p>
                      <div className="mt-2 space-y-2">
                        <label className="text-xs font-medium text-slate-600">
                          {t("Area", "Area")}
                        </label>
                        <select
                          value={endAreaKey}
                          onChange={event => {
                            const value = event.target.value
                            setEndAreaKey(value)
                            setEndSubareaKey("")
                            if (value !== "otro") setEndAreaDetail("")
                          }}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="">{t("Selecciona un area", "Select an area")}</option>
                          {shiftAreaOptions.map(option => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {endAreaKey === "otro" && (
                          <input
                            value={endAreaDetail}
                            onChange={event => setEndAreaDetail(event.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder={t("Describe el area", "Describe the area")}
                          />
                        )}
                        {endAreaKey && endAreaKey !== "otro" && (
                          <select
                            value={endSubareaKey}
                            onChange={event => setEndSubareaKey(event.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="">{t("Selecciona una subarea", "Select a subarea")}</option>
                            {(subareaOptionsByArea.get(endAreaKey) ?? []).map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        )}
                        <CameraCapture onCapture={handleCaptureEndPhoto} overlayLines={endOverlayLines} />
                        {endPhotoCaptures.length > 0 && (
                          <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                            <p className="font-semibold text-slate-700">
                              {t("Fotos capturadas", "Captured photos")}: {endPhotoCaptures.length}
                            </p>
                            {endPhotoCaptures.map((item, index) => (
                              <div key={item.id} className="flex items-center justify-between gap-2">
                                <div>
                                  <p className="font-medium text-slate-700">
                                    {t("Foto", "Photo")} #{index + 1}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    {getAreaLabel(item.areaKey, item.areaDetail, item.subareaKey)}
                                  </p>
                                </div>
                                <Button size="sm" variant="ghost" onClick={() => handleRemoveEndPhoto(item.id)}>
                                  {t("Quitar", "Remove")}
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
                    <span>{t("GPS", "GPS")}: {coords ? t("Listo", "Ready") : t("Pendiente", "Pending")}</span>
                    <span>
                      {t("Fotos de salida", "Exit photos")}:{" "}
                      {endEvidenceUploaded
                        ? t("Registradas", "Registered")
                        : endPhotoCaptures.length > 0
                          ? `${endPhotoCaptures.length} ${t("listas", "ready")}`
                          : t("Pendiente", "Pending")}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!endEvidenceUploaded ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleUploadEndEvidence()}
                        disabled={uploadingEndEvidence || !coords || !endPhotosReady}
                      >
                        {uploadingEndEvidence
                          ? t("Almacenando datos...", "Saving data...")
                          : t("Registrar fin de la tarea", "Register task end")}
                      </Button>
                    ) : (
                      <Badge variant="success">{t("Fin de tarea registrado", "Task end registered")}</Badge>
                    )}
                  </div>
                  {endEvidenceUploadError && (
                    <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      {endEvidenceUploadError}
                    </div>
                  )}
                </div>

                {activeShift && hasStartEvidence && (
                  <>
                    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                      <p className="font-semibold text-slate-800">{t("Observaciones (opcional)", "Observations (optional)")}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {t(
                          "Deja notas de la tarea especial o novedades durante el turno.",
                          "Leave notes about the special task or shift updates."
                        )}
                      </p>
                      <textarea
                        rows={3}
                        value={endObservation}
                        onChange={event => setEndObservation(event.target.value)}
                        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
                        placeholder={t("Observaciones de la tarea especial", "Special task notes")}
                      />
                    </div>

                    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                      <p className="font-semibold text-slate-800">{t("Tareas especiales completadas", "Special tasks completed")}</p>
                      {completedEmployeeTasks.length > 0 ? (
                        <ul className="mt-2 space-y-2">
                          {completedEmployeeTasks.map(task => (
                            <li key={task.id} className="flex items-center gap-2 text-sm text-slate-700">
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                                ✓
                              </span>
                              <span>{task.title}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500">
                          {t("No hay tareas especiales registradas.", "No special tasks recorded.")}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                      <p className="font-semibold text-slate-800">{t("Resumen del turno", "Shift summary")}</p>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <p className="text-xs text-slate-500">{t("Restaurante", "Restaurant")}</p>
                          <p className="font-semibold text-slate-800">{activeRestaurantLabel}</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <p className="text-xs text-slate-500">{t("Fotos de salida", "Exit photos")}</p>
                          <p className="font-semibold text-slate-800">
                            {endEvidenceUploaded ? `${endEvidenceCount} ${t("imagenes", "images")}` : t("Pendiente", "Pending")}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <p className="text-xs text-slate-500">{t("Ubicacion", "Location")}</p>
                          <p className="font-semibold text-slate-800">
                            {coords ? t("Verificada", "Verified") : t("Pendiente", "Pending")}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                </>
              )}

              {activeShift && hasStartEvidence ? (
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
              ) : null}

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-medium text-slate-800">
                  {activeShift
                    ? t("Finalizaste el turno en buenas condiciones?", "Did you finish the shift in good condition?")
                    : t("Certificado de aptitud", "Fitness certificate")}
                </p>
                {!activeShift && (
                  <p className="mt-1 text-xs text-slate-600">
                    {t(
                      "Confirma que estas en condiciones para iniciar el turno.",
                      "Confirm you are fit to start the shift."
                    )}
                  </p>
                )}
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

              {activeShift && hasStartEvidence && earlyEndReasonRequired && (
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

              {!activeShift && (
                <div className="mt-3">
                  <textarea
                    rows={3}
                    value={startObservation}
                    onChange={event => setStartObservation(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
                    placeholder={t("Observacion inicial (opcional)", "Initial observation (optional)")}
                  />
                </div>
              )}

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
                    {processing ? t("Almacenando datos...", "Saving data...") : t("Registrar inicio", "Register start")}
                  </Button>
                ) : hasStartEvidence ? (
                  <Button onClick={handleEnd} disabled={!canSubmit} variant="danger">
                    {processing ? t("Almacenando datos...", "Saving data...") : t("Finalizar turno", "End shift")}
                  </Button>
                ) : null}
              </div>

              {activeShift && hasStartEvidence && endShiftError && (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {endShiftError}
                </div>
              )}

              {submitBlockers.length > 0 && (!activeShift || hasStartEvidence) && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
                  {submitBlockers.map(item => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}

            {isEmpleado && activeShift && isEmployeeEndStage && (
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

            {isEmpleado && activeShift && isEmployeeEndStage && (
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
                              `${t("Direccion", "Address")}: ${taskAddress || t("pendiente", "pending")}`,
                              `${t("Restaurante", "Restaurant")}: ${getRestaurantWatermarkLabelById(selectedTask?.restaurant_id)}`,
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
                                  `${t("Direccion", "Address")}: ${taskAddress || t("pendiente", "pending")}`,
                                  `${t("Restaurante", "Restaurant")}: ${getRestaurantWatermarkLabelById(selectedTask?.restaurant_id)}`,
                                ]}
                              />
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                              <p className="text-sm font-semibold text-slate-700">{t("Vista general", "Wide overview")}</p>
                              <p className="mb-2 text-xs text-slate-500">{t("Captura una vista panoramica final del espacio completo.", "Capture a final panoramic view of the full space.")}</p>
                              <CameraCapture
                                onCapture={setTaskPhotoWide}
                                overlayLines={[
                                  `${t("Direccion", "Address")}: ${taskAddress || t("pendiente", "pending")}`,
                                  `${t("Restaurante", "Restaurant")}: ${getRestaurantWatermarkLabelById(selectedTask?.restaurant_id)}`,
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

          </section>
        )}

        {canOperateSupervisor && (
          <section className={`space-y-5 ${manrope.className}`}>
            <div className="space-y-5">
                {supervisorScreen === "home" && (
                  <div className="space-y-5">
                    <div className="page-title">{t("Panel de Control", "Control panel")}</div>

                    <div className="welcome-banner">
                      <h2>{t("¡Bienvenido, Supervisor!", "Welcome, Supervisor!")}</h2>
                      <p>{t("Gestión de equipos de limpieza", "Cleaning team management")}</p>
                    </div>

                    <div className="quick-actions">
                      <button type="button" className="quick-action-btn" onClick={() => router.push("/restaurants")}>
                        <span className="quick-action-icon">🏬</span>
                        <span>{t("Restaurantes", "Restaurants")}</span>
                      </button>
                      <button type="button" className="quick-action-btn" onClick={() => router.push("/users")}>
                        <span className="quick-action-icon">👥</span>
                        <span>{t("Empleados", "Employees")}</span>
                      </button>
                      <button type="button" className="quick-action-btn" onClick={() => setSupervisorScreenWithHistory("turnos")}>
                        <span className="quick-action-icon">🗓️</span>
                        <span>{t("Turnos", "Shifts")}</span>
                      </button>
                      <button type="button" className="quick-action-btn" onClick={() => router.push("/reports")}>
                        <span className="quick-action-icon">📊</span>
                        <span>{t("Informes", "Reports")}</span>
                      </button>
                    </div>

                    {supervisorOtpHint}

                    <div className="card">
                      <div className="card-header">
                        <div className="card-title">{t("Alertas Recientes", "Recent alerts")}</div>
                      </div>
                      {overdueSupervisorTasks.length === 0 && pendingPresenceClosures.length === 0 ? (
                        <div className="alert alert-success">
                          <span>✅</span>
                          <span>{t("Sin alertas pendientes por ahora.", "No pending alerts right now.")}</span>
                        </div>
                      ) : (
                        <div className="alert alert-warning">
                          <span>⚠️</span>
                          <div>
                            {overdueSupervisorTasks.length > 0 && (
                              <p>
                                {t("Hay", "There are")} {overdueSupervisorTasks.length}{" "}
                                {t("tarea(s) vencidas pendientes de cierre.", "overdue task(s) pending closure.")}
                              </p>
                            )}
                            {pendingPresenceClosures.length > 0 && (
                              <p>
                                {t("Tienes", "You have")} {pendingPresenceClosures.length}{" "}
                                {t("restaurante(s) con entrada registrada pero sin salida hoy.", "restaurant(s) with entry registered but no exit today.")}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {supervisorScreen === "turnos" && (
                  <div className="space-y-5">
                    <div className="page-title">
                      <button
                        type="button"
                        className="header-btn"
                        onClick={() => setSupervisorScreenWithHistory("home")}
                        aria-label={t("Volver", "Back")}
                      >
                        ←
                      </button>
                      {t("Programación de Turnos", "Shift scheduling")}
                    </div>

                    {supervisorOtpHint}

                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setSupervisorScreenWithHistory("schedule")}
                      style={{ marginBottom: "20px" }}
                    >
                      {t("Programar Turno", "Schedule shift")}
                    </button>

                    <div className="card">
                      <div className="card-header">
                        <div className="card-title">{t("Turnos de Hoy", "Today's shifts")}</div>
                      </div>
                      {supervisorRows.length === 0 ? (
                        <p className="text-sm text-slate-500">
                          {t("No hay turnos activos en este momento.", "No active shifts right now.")}
                        </p>
                      ) : (
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>{t("Empleado", "Employee")}</th>
                              <th>{t("Restaurante", "Restaurant")}</th>
                              <th>{t("Horario", "Schedule")}</th>
                              <th>{t("Estado", "Status")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {supervisorRows.slice(0, 10).map(row => {
                              const badge = getSupervisorStatusBadge(row.status)
                              return (
                                <tr key={row.id}>
                                  <td>{row.employee_id?.slice(0, 8) ?? t("Sin asignar", "Unassigned")}</td>
                                  <td>{getRestaurantLabelById(row.restaurant_id)}</td>
                                  <td>{formatTimeOnly(row.start_time)} - {row.end_time ? formatTimeOnly(row.end_time) : "—"}</td>
                                  <td><span className={badge.className}>{badge.label}</span></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}

            {supervisorScreen === "otp" && !canOperateShift && (
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

                  {otpDebugCode && (
                    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                        {t("Codigo en pantalla", "On-screen code")}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-white px-2 py-1 font-mono text-base font-semibold text-emerald-900">
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
                      <div className="mt-1 text-[11px] text-emerald-700">
                        {otpDebugMaskedPhone ? `${t("Referencia", "Reference")}: ${otpDebugMaskedPhone}. ` : ""}
                        {otpDebugExpiresAt ? `${t("Expira", "Expires")}: ${formatDateTime(otpDebugExpiresAt)}` : ""}
                      </div>
                    </div>
                  )}

                  <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_auto]">
                    <input
                      value={otpCode}
                      onChange={event => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      maxLength={6}
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

            {supervisorScreen === "schedule" && (
              <div className="space-y-5">
                <div className="page-title">
                  <button
                    type="button"
                    className="header-btn"
                    onClick={() => setSupervisorScreenWithHistory("turnos")}
                    aria-label={t("Volver", "Back")}
                  >
                    ←
                  </button>
                  {t("Programar Turno", "Schedule shift")}
                </div>

                <div className="card">
                  <div className="card-header">
                    <div className="card-title">{t("Detalles del turno", "Shift details")}</div>
                  </div>

                  <div className="form-group">
                    <label>{t("Empleado", "Employee")}</label>
                    <select
                      value={supervisorScheduleEmployeeId}
                      onChange={event => setSupervisorScheduleEmployeeId(event.target.value)}
                    >
                      <option value="">{t("Seleccionar empleado", "Select employee")}</option>
                      {supervisorScheduleEligibleUsers.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.full_name ?? item.email ?? item.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>{t("Restaurante", "Restaurant")}</label>
                    <select
                      value={supervisorScheduleRestaurantId ?? ""}
                      onChange={event => setSupervisorScheduleRestaurantId(Number(event.target.value) || null)}
                    >
                      <option value="">{t("Seleccionar restaurante", "Select restaurant")}</option>
                      {staffRestaurants.map(item => (
                        <option key={item.id} value={item.id}>
                          {formatRestaurantLabel(knownRestaurantsById.get(item.id)) || item.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-row two-col">
                    <div className="form-group">
                      <label>{t("Fecha", "Date")}</label>
                      <input
                        type="date"
                        value={supervisorBulkRangeStart}
                        onChange={event => setSupervisorBulkRangeStart(event.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>{t("Horas asignadas", "Assigned hours")}</label>
                      <input type="number" value={scheduleHoursValue} readOnly />
                    </div>
                  </div>

                  <div className="form-row two-col">
                    <div className="form-group">
                      <label>{t("Hora Inicio", "Start time")}</label>
                      <input
                        type="time"
                        value={supervisorBulkStartTime}
                        onChange={event => setSupervisorBulkStartTime(event.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>{t("Hora Fin", "End time")}</label>
                      <input
                        type="time"
                        value={supervisorBulkEndTime}
                        onChange={event => setSupervisorBulkEndTime(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>{t("Tarea Especial (opcional)", "Special task (optional)")}</label>
                    <input
                      type="text"
                      value={supervisorScheduleNotes}
                      onChange={event => setSupervisorScheduleNotes(event.target.value)}
                      placeholder={t("Descripción de tarea especial", "Special task description")}
                    />
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleScheduleSupervisorShiftSingle()}
                    disabled={supervisorBulkScheduling}
                  >
                    {supervisorBulkScheduling ? t("Programando...", "Scheduling...") : t("Programar Turno", "Schedule shift")}
                  </button>
                </div>

                <details className="card">
                  <summary className="card-title">{t("Opciones avanzadas", "Advanced options")}</summary>
                  <div className="mt-4">
                    <Card title={t("Programar turnos", "Schedule shifts")}>
                      <div className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {t("Empleado y restaurante", "Employee & restaurant")}
                        </p>
                        <p className="text-xs text-slate-500">
                          {t("Selecciona a quien asignaras el turno.", "Choose who will receive the shift.")}
                        </p>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {t("Empleado", "Employee")}
                          </p>
                          <select
                            value={supervisorScheduleEmployeeId}
                            onChange={event => setSupervisorScheduleEmployeeId(event.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="">{t("Seleccionar empleado", "Select employee")}</option>
                            {supervisorScheduleEligibleUsers.map(item => (
                              <option key={item.id} value={item.id}>
                                {item.full_name ?? item.email ?? item.id}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {t("Restaurante", "Restaurant")}
                          </p>
                          <select
                            value={supervisorScheduleRestaurantId ?? ""}
                            onChange={event => setSupervisorScheduleRestaurantId(Number(event.target.value) || null)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="">{t("Seleccionar restaurante", "Select restaurant")}</option>
                            {staffRestaurants.map(item => (
                              <option key={item.id} value={item.id}>
                                {formatRestaurantLabel(knownRestaurantsById.get(item.id)) || item.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">{t("Seleccionado", "Selected")}:</span>{" "}
                        {selectedSupervisorScheduleEmployeeLabel} · {selectedSupervisorScheduleRestaurantLabel}
                      </div>
                    </div>

                    <details className="rounded-2xl border border-slate-200 bg-white p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                        {t("Importar Excel/CSV", "Import Excel/CSV")}
                      </summary>
                      <div className="mt-3 space-y-2">
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          onChange={event => {
                            void handleImportSupervisorScheduleFile(event.target.files?.[0] ?? null)
                            event.currentTarget.value = ""
                          }}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <p className="text-xs text-slate-500">
                          {t(
                            "Columnas esperadas: start/end o scheduled_start/scheduled_end. Aplica al empleado/restaurante seleccionado.",
                            "Expected columns: start/end or scheduled_start/scheduled_end. Applies to selected employee/restaurant."
                          )}
                        </p>
                      </div>
                    </details>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{t("Fechas y horario", "Dates & time")}</p>
                        <p className="text-xs text-slate-500">
                          {t("Define el rango y las horas del turno.", "Define the date range and shift hours.")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={() => handleApplySupervisorBulkPreset("day")}>
                          {t("Hoy", "Today")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleApplySupervisorBulkPreset("week")}>
                          {t("Semana", "Week")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleApplySupervisorBulkPreset("month")}>
                          {t("Mes", "Month")}
                        </Button>
                      </div>
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

                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("Dias de la semana", "Weekdays")}
                      </p>
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
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{t("Bloques a programar", "Blocks to schedule")}</p>
                        <p className="text-xs text-slate-500">
                          {t("Genera bloques automaticamente o agrega manualmente.", "Generate blocks automatically or add manually.")}
                        </p>
                      </div>
                      <span className="text-xs text-slate-500">
                        {t("Total", "Total")}: {supervisorScheduleBlocks.length}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={handleGenerateSupervisorScheduleBlocks}>
                        {t("Generar bloques", "Generate blocks")}
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
                        {t("Limpiar", "Clear")}
                      </Button>
                    </div>

                    <div className="mt-3 space-y-2">
                      {supervisorScheduleBlocks.length === 0 ? (
                        <p className="text-xs text-slate-500">{t("No hay bloques agregados.", "No blocks added.")}</p>
                      ) : (
                        supervisorScheduleBlocks.map(block => (
                          <div key={block.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                            <div className="space-y-1">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                {t("Inicio", "Start")}
                              </p>
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
                            </div>
                            <div className="space-y-1">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                {t("Fin", "End")}
                              </p>
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
                            </div>
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
                      placeholder={t("Notas del turno (opcional)", "Shift notes (optional)")}
                    />
                  </div>

                  <details className="rounded-xl border border-slate-200 bg-white p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                      {t("Tareas opcionales", "Optional tasks")}
                    </summary>
                    <div className="mt-3 space-y-3">
                      <Button size="sm" variant="ghost" onClick={handleAddSupervisorScheduleTaskDraft}>
                        {t("Agregar tarea", "Add task")}
                      </Button>

                      {supervisorScheduleTaskDrafts.length === 0 ? (
                        <p className="text-xs text-slate-500">{t("Sin tareas opcionales.", "No optional tasks.")}</p>
                      ) : (
                        <div className="space-y-3">
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
                  </details>

                  <div className="flex flex-wrap items-center justify-between gap-2">
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
                  </div>
                </details>
              </div>
            )}

            {supervisorScreen === "presence" && isSupervisora && (
              <div className="space-y-5">
                <div className="page-title">{t("Supervisión en Sitio", "On-site supervision")}</div>

                <div className="gps-verification">
                  <div className="info-icon" style={{ margin: "0 auto 10px" }}>
                    📍
                  </div>
                  <h4>{t("Verificación de Ubicación", "Location verification")}</h4>
                  <div className={`gps-status ${presenceGpsStatus === "valid" ? "valid" : "invalid"}`}>
                    <span>{presenceGpsStatus === "checking" ? "⏳" : presenceGpsStatus === "valid" ? "✅" : "❌"}</span>
                    <span>{presenceGpsMessage || t("Verificando GPS...", "Checking GPS...")}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={verifyPresenceGps}
                    style={{ marginTop: "15px" }}
                  >
                    {presenceGpsStatus === "checking"
                      ? t("Verificando...", "Verifying...")
                      : t("Verificar Ubicación", "Verify location")}
                  </button>
                </div>

                {supervisionStep === "cleaning" ? (
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title">{t("Limpieza en progreso", "Cleaning in progress")}</div>
                    </div>
                    <p className="text-sm text-slate-500">
                      {t("No cierre la aplicación mientras continúa la supervisión.", "Do not close the app while supervision continues.")}
                    </p>
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={() => setSupervisionStep("end")}
                      style={{ marginTop: "15px" }}
                    >
                      {t("Continuar Supervisión", "Continue supervision")}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="card">
                      <div className="card-header">
                        <div className="card-title">{t("Fotos de Supervisión", "Supervision photos")}</div>
                      </div>

                      <div className="form-group">
                        <label>{t("Restaurante", "Restaurant")}</label>
                        <select
                          value={presenceRestaurantId ?? ""}
                          onChange={event => setPresenceRestaurantId(Number(event.target.value) || null)}
                        >
                          <option value="">{t("Seleccionar restaurante", "Select restaurant")}</option>
                          {presenceRestaurants.map(restaurant => (
                            <option key={restaurant.id} value={restaurant.id}>
                              {formatRestaurantLabel(knownRestaurantsById.get(restaurant.id)) || restaurant.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="form-row two-col">
                        <div className="form-group">
                          <label>{t("Área", "Area")}</label>
                          <select
                            value={supervisionAreaKey}
                            onChange={event => setSupervisionAreaKey(event.target.value)}
                          >
                            <option value="">{t("Seleccionar área", "Select area")}</option>
                            {shiftAreaOptions.map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group">
                          <label>{t("Subárea", "Subarea")}</label>
                          <select
                            value={supervisionSubareaKey}
                            onChange={event => setSupervisionSubareaKey(event.target.value)}
                            disabled={!supervisionAreaKey || supervisionSubareas.length === 0}
                          >
                            <option value="">{t("Seleccionar subárea", "Select subarea")}</option>
                            {supervisionSubareas.map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {supervisionAreaKey === "otro" && (
                        <div className="form-group">
                          <label>{t("Detalle del área", "Area detail")}</label>
                          <input
                            value={supervisionAreaDetail}
                            onChange={event => setSupervisionAreaDetail(event.target.value)}
                            placeholder={t("Describe el área", "Describe the area")}
                          />
                        </div>
                      )}

                      <div className="photo-grid">
                        {(supervisionStep === "start" ? supervisionStartPhotos : supervisionEndPhotos).map(photo => (
                          <div key={photo.id} className="photo-slot has-image">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photo.previewUrl} alt="supervision" />
                            <button
                              type="button"
                              className="remove-btn"
                              onClick={() =>
                                handleRemoveSupervisionPhoto(supervisionStep === "start" ? "start" : "end", photo.id)
                              }
                            >
                              ×
                            </button>
                            <label>{getAreaLabel(photo.areaKey, photo.areaDetail, photo.subareaKey)}</label>
                          </div>
                        ))}
                        <div
                          className="photo-slot"
                          role="button"
                          tabIndex={0}
                          onClick={() => setSupervisionCameraOpen(true)}
                          onKeyDown={event => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              setSupervisionCameraOpen(true)
                            }
                          }}
                        >
                          <span style={{ fontSize: "32px", color: "var(--gray)" }}>📷</span>
                          <label>{t("Agregar foto", "Add photo")}</label>
                        </div>
                      </div>

                      {supervisionCameraOpen && (
                        <div className="space-y-3">
                          <CameraCapture
                            onCapture={handleCaptureSupervisionPhoto}
                            overlayLines={[
                              `${t("Direccion", "Address")}: ${presenceAddress || t("pendiente", "pending")}`,
                              `${t("Restaurante", "Restaurant")}: ${getRestaurantWatermarkLabelById(presenceRestaurantId)}`,
                            ]}
                          />
                          <button type="button" className="btn btn-secondary" onClick={() => setSupervisionCameraOpen(false)}>
                            {t("Cerrar cámara", "Close camera")}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="form-group">
                      <label>{t("Observaciones", "Observations")}</label>
                      <textarea
                        value={supervisionObservation}
                        onChange={event => setSupervisionObservation(event.target.value)}
                        placeholder={t("Registre sus observaciones de la supervisión...", "Add supervision observations...")}
                      />
                    </div>

                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={() =>
                        supervisionStep === "start"
                          ? void handleRegisterSupervisionStart()
                          : void handleRegisterSupervisionEnd()
                      }
                      disabled={supervisionUploading}
                    >
                      {supervisionUploading
                        ? t("Guardando...", "Saving...")
                        : supervisionStep === "start"
                          ? t("Guardar Supervisión", "Save supervision")
                          : t("Finalizar Supervisión", "Finish supervision")}
                    </button>
                  </>
                )}

                {supervisorPresence.length > 0 && (
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title">{t("Historial reciente", "Recent history")}</div>
                    </div>
                    <ul className="text-sm text-slate-500">
                      {supervisorPresence.slice(0, 6).map(item => (
                        <li key={item.id}>
                          {formatDateTime(item.recorded_at)} · {getRestaurantLabelById(item.restaurant_id)} · {item.phase}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {supervisorScreen === "tasks" && (
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

                      {editingTaskId === task.id ? (
                        <div className="mt-3 space-y-2">
                          <input
                            value={editingTaskTitle}
                            onChange={event => setEditingTaskTitle(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                            placeholder={t("Titulo de tarea", "Task title")}
                          />
                          <textarea
                            value={editingTaskDescription}
                            onChange={event => setEditingTaskDescription(event.target.value)}
                            rows={2}
                            className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                            placeholder={t("Descripcion", "Description")}
                          />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <select
                              value={editingTaskPriority}
                              onChange={event => setEditingTaskPriority(event.target.value as TaskPriority)}
                              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                            >
                              <option value="low">{t("Baja", "Low")}</option>
                              <option value="normal">{t("Normal", "Normal")}</option>
                              <option value="high">{t("Alta", "High")}</option>
                              <option value="critical">{t("Critica", "Critical")}</option>
                            </select>
                            <input
                              type="datetime-local"
                              value={editingTaskDueAt}
                              onChange={event => setEditingTaskDueAt(event.target.value)}
                              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => void handleSaveTaskEdit()}
                              disabled={savingTaskEditId === task.id}
                            >
                              {savingTaskEditId === task.id ? t("Guardando...", "Saving...") : t("Guardar", "Save")}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={resetTaskEditState}>
                              {t("Cerrar", "Close")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        task.status !== "completed" &&
                        task.status !== "cancelled" && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary" onClick={() => handleStartEditTask(task)}>
                              {t("Modificar", "Edit")}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void handleCloseSupervisorTask(task.id)}
                              disabled={closingTaskId === task.id}
                            >
                              {closingTaskId === task.id ? t("Cerrando...", "Closing...") : t("Cerrar tarea", "Close task")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleCancelSupervisorTask(task.id)}
                              disabled={cancelingTaskId === task.id}
                            >
                              {cancelingTaskId === task.id ? t("Cancelando...", "Cancelling...") : t("Cancelar", "Cancel")}
                            </Button>
                          </div>
                        )
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
            )}

            {supervisorScreen === "alerts" && (
              <Card title={t("Gestion de alertas", "Alert management")}>
                {!shiftOtpReady && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    {t("Valida OTP para registrar alertas.", "Verify OTP to register alerts.")}
                  </div>
                )}

                {loadingSupervisor ? (
                  <Skeleton className="h-20" />
                ) : supervisorRows.length === 0 ? (
                  <p className="text-sm text-slate-500">{t("No hay turnos activos para alertas.", "No active shifts for alerts.")}</p>
                ) : (
                  <div className="space-y-3">
                    {supervisorRows.map(row => (
                      <div key={`alert-${row.id}`} className="rounded-lg border border-slate-200 px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium text-slate-800">
                            {t("Empleado", "Employee")}: {row.employee_id?.slice(0, 8) ?? "-"}
                          </p>
                          <span className="text-xs text-slate-500">
                            {formatDateTime(row.start_time)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {t("Restaurante", "Restaurant")}: {getRestaurantLabelById(row.restaurant_id)}
                        </p>

                        <div className="mt-3 space-y-2">
                          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {t("Nueva alerta", "New alert")}
                          </label>
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
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder={t("Describe la alerta o incidente...", "Describe the alert or incident...")}
                          />
                          <Button size="sm" variant="primary" onClick={() => void handleCreateIncident(row.id)}>
                            {t("Guardar alerta", "Save alert")}
                          </Button>
                        </div>

                        {(incidentHistory[row.id] ?? []).length > 0 && (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                            <p className="mb-2 font-semibold text-slate-600">{t("Alertas recientes", "Recent alerts")}</p>
                            <ul className="space-y-1">
                              {incidentHistory[row.id].map(incident => (
                                <li key={incident.id}>
                                  {formatDateTime(incident.created_at)} - {incident.note}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {supervisorScreen === "scheduled" && (
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
            )}

            {supervisorScreen === "active" && (
              <>
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
              </>
            )}
            </div>
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

export default function ShiftsPage() {
  return (
    <Suspense fallback={<div className={manrope.className} />}>
      <ShiftsPageContent />
    </Suspense>
  )
}

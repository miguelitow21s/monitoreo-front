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
  ShiftRecord,
  startShift,
} from "@/services/shifts.service"
import { uploadShiftEvidence } from "@/services/evidence.service"
import {
  listMySupervisorPresence,
  registerSupervisorPresence,
  SupervisorPresenceLog,
} from "@/services/supervisorPresence.service"
import { listMyScheduledShifts, ScheduledShift } from "@/services/scheduling.service"
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
} from "@/services/tasks.service"
import { listMySupervisorRestaurants, listRestaurants, SupervisorRestaurantOption } from "@/services/restaurants.service"
import { uploadEvidenceObject } from "@/services/storageEvidence.service"

const HISTORY_PAGE_SIZE = 8
const TASK_EVIDENCE_SHOTS = [
  { key: "close_up", label: "Close-up", helper: "Capture a direct detail of the intervened area." },
  { key: "mid_range", label: "Mid-range shot", helper: "Capture from mid distance showing nearby context." },
  { key: "wide_general", label: "Wide overview", helper: "Capture a final panoramic view of the full space." },
] as const
const TASK_SHOT_ORDER: Record<string, number> = {
  close_up: 1,
  mid_range: 2,
  wide_general: 3,
}

type TaskEvidenceShotKey = (typeof TASK_EVIDENCE_SHOTS)[number]["key"]

function formatDuration(start: string, end: string | null) {
  const startDate = new Date(start).getTime()
  const endDate = new Date(end ?? Date.now()).getTime()
  if (!Number.isFinite(startDate) || !Number.isFinite(endDate) || endDate < startDate) return "-"

  const minutes = Math.floor((endDate - startDate) / 60000)
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return `${hours}h ${restMinutes}m`
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
  const { formatDateTime: formatDateTimeI18n } = useI18n()
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
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotalPages, setHistoryTotalPages] = useState(1)
  const [scheduledShifts, setScheduledShifts] = useState<ScheduledShift[]>([])
  const [startObservation, setStartObservation] = useState("")
  const [endObservation, setEndObservation] = useState("")
  const [startFitForWork, setStartFitForWork] = useState<boolean | null>(null)
  const [endFitForWork, setEndFitForWork] = useState<boolean | null>(null)
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

  const healthAnswered = activeShift ? endFitForWork !== null : startFitForWork !== null
  const healthDeclarationRequired =
    activeShift ? endFitForWork === false : startFitForWork === false
  const healthDeclarationProvided = activeShift
    ? endHealthDeclaration.trim().length > 0
    : startHealthDeclaration.trim().length > 0

  const canSubmit = !!coords && !!photo && !processing && healthAnswered && (!healthDeclarationRequired || healthDeclarationProvided)

  const submitBlockers = useMemo(() => {
    const blockers: string[] = []
    if (!coords) blockers.push("You must capture GPS location.")
    if (!photo) blockers.push("You must capture photo evidence.")
    if (!healthAnswered) {
      blockers.push(
        activeShift
          ? "You must answer the exit health condition."
          : "You must answer the entry health condition."
      )
    }
    if (healthDeclarationRequired && !healthDeclarationProvided) {
      blockers.push("You must provide a declaration when health condition is not optimal.")
    }
    if (processing) blockers.push("There is an action in progress.")
    return blockers
  }, [coords, photo, healthAnswered, healthDeclarationRequired, healthDeclarationProvided, processing, activeShift])

  const canOperateEmployee = isEmpleado || isSuperAdmin
  const canOperateSupervisor = isSupervisora || isSuperAdmin
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
  const shiftOverlayLines = [
    `User: ${currentUserId ?? "unknown"}`,
    `Phase: ${activeShift ? "shift-end" : "shift-start"}`,
    coords ? `GPS: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : "GPS: pending",
  ]

  const loadEmployeeData = useCallback(async (page: number) => {
    setLoadingData(true)
    try {
      const [active, historyResult, scheduledResult] = await Promise.all([
        getMyActiveShift(),
        getMyShiftHistory(page, HISTORY_PAGE_SIZE),
        listMyScheduledShifts(100),
      ])
      setActiveShift(active)
      setHistory(historyResult.rows)
      setHistoryTotalPages(historyResult.totalPages)
      setScheduledShifts(scheduledResult)
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not load shift information."))
    } finally {
      setLoadingData(false)
    }
  }, [showToast])

  const loadSupervisorData = useCallback(async () => {
    setLoadingSupervisor(true)
    try {
      const rows = await getActiveShiftsForSupervision(30)
      setSupervisorRows(rows)
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not load active shifts."))
    } finally {
      setLoadingSupervisor(false)
    }
  }, [showToast])

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
      showToast("error", extractErrorMessage(error, "Could not load restaurants for supervisor presence."))
    }
  }, [canOperateSupervisor, isSuperAdmin, showToast])

  useEffect(() => {
    if (!canOperateEmployee) return
    void loadEmployeeData(historyPage)
  }, [historyPage, canOperateEmployee, loadEmployeeData])

  useEffect(() => {
    if (!canOperateSupervisor) return
    void loadSupervisorData()
  }, [canOperateSupervisor, loadSupervisorData])

  useEffect(() => {
    if (!canOperateSupervisor) return
    void loadPresenceRestaurants()
  }, [canOperateSupervisor, loadPresenceRestaurants])

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
        const items = await listSupervisorOperationalTasks(60)
        setSupervisorTasks(items)
      }
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not load operational tasks."))
    } finally {
      setLoadingTasks(false)
    }
  }, [canOperateEmployee, canOperateSupervisor, showToast])

  const loadPresenceLogs = useCallback(async () => {
    if (!canOperateSupervisor) return
    try {
      const rows = await listMySupervisorPresence(20)
      setSupervisorPresence(rows)
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not load supervisor presence records."))
    }
  }, [canOperateSupervisor, showToast])

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

  const uploadEvidence = async (
    prefix: string,
    blob: Blob,
    position: Coordinates,
    options?: {
      extension?: string
    }
  ) => {
    if (!currentUserId) throw new Error("Authenticated user was not found.")
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

  const handleStart = async () => {
    if (!canSubmit || !coords) return
    setProcessing(true)
    let startedShiftId: number | null = null

    try {
      if (startFitForWork === null) throw new Error("You must confirm you are fit for work at shift start.")

      const latestActive = await getMyActiveShift()
      if (latestActive) {
        setActiveShift(latestActive)
        throw new Error("There is already an active shift. End it before starting another.")
      }

      if (!photo) throw new Error("You must capture photo evidence.")
      const currentRestaurantId = getCurrentScheduledRestaurantId(scheduledShifts)
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
      })

      if (startObservation.trim()) {
        await createShiftIncident(String(shiftId), `[INGRESO] ${startObservation.trim()}`)
      }

      showToast("success", "Shift started successfully.")
      resetEvidenceAndLocation()
      setStartObservation("")
      setStartFitForWork(null)
      setStartHealthDeclaration("")
      setHistoryPage(1)
      await loadEmployeeData(1)
      await loadSupervisorData()
    } catch (error: unknown) {
      if (startedShiftId) {
        await loadEmployeeData(1)
      }
      if (isConsentPendingError(error)) {
        showToast("error", "Consent pending: accept data processing terms to operate shifts.")
        return
      }
      showToast("error", extractErrorMessage(error, "Could not start shift."))
    } finally {
      setProcessing(false)
    }
  }

  const handleEnd = async () => {
    if (!canSubmit || !coords || !activeShift) return
    setProcessing(true)

    try {
      if (endFitForWork === null) throw new Error("You must confirm your condition when ending shift.")
      if (!endFitForWork && !endHealthDeclaration.trim()) {
        throw new Error("You must describe incidents if your end condition is not optimal.")
      }

      if (!photo) throw new Error("You must capture photo evidence.")
      await uploadShiftEvidence({
        shiftId: Number(activeShift.id),
        type: "fin",
        file: photo,
        lat: coords.lat,
        lng: coords.lng,
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

      showToast("success", "Shift ended successfully.")
      resetEvidenceAndLocation()
      setEndObservation("")
      setEndFitForWork(null)
      setEndHealthDeclaration("")
      setHistoryPage(1)
      await loadEmployeeData(1)
      await loadSupervisorData()
    } catch (error: unknown) {
      if (isConsentPendingError(error)) {
        showToast("error", "Consent pending: accept data processing terms to operate shifts.")
        return
      }
      showToast("error", extractErrorMessage(error, "Could not end shift."))
    } finally {
      setProcessing(false)
    }
  }

  const handleStatusChange = async (shiftId: string, status: string) => {
    try {
      await updateShiftStatus(shiftId, status)
      showToast("success", `Shift updated to ${status}.`)
      await loadSupervisorData()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not update shift status."))
    }
  }

  const handleCreateIncident = async (shiftId: string) => {
    const note = (incidentNotes[shiftId] ?? "").trim()
    if (!note) {
      showToast("info", "Write an incident before saving.")
      return
    }

    try {
      const incident = await createShiftIncident(shiftId, note)
      setIncidentNotes(prev => ({ ...prev, [shiftId]: "" }))
      setIncidentHistory(prev => ({
        ...prev,
        [shiftId]: [incident, ...(prev[shiftId] ?? [])],
      }))
      showToast("success", "Incident saved.")
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not save incident."))
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
      showToast("info", "Write a note before saving.")
      return
    }

    setCreatingEmployeeIncident(true)
    try {
      await createShiftIncident(activeShift.id, `[EMPLEADO] ${note}`)
      setEmployeeIncident("")
      showToast("success", "Note saved successfully.")
      await loadSupervisorData()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not save note."))
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
      showToast("info", "Task title and description are required.")
      return
    }
    if (!row.restaurant_id || !row.employee_id) {
      showToast("error", "Shift is missing restaurant/employee relation.")
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
      showToast("success", "Operational task created.")
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not create task."))
    } finally {
      setCreatingTaskForShift(null)
    }
  }

  const handleSetTaskInProgress = async (taskId: number) => {
    try {
      await markTaskInProgress(taskId)
      showToast("success", "Task marked as in progress.")
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not update task status."))
    }
  }

  const handleCompleteTask = async () => {
    if (!selectedTaskId) {
      showToast("info", "Select a task to complete.")
      return
    }
    if (!taskCoords || !taskPhotoClose || !taskPhotoMid || !taskPhotoWide) {
      showToast("info", "Completing a task requires GPS and 3 evidences: close-up, mid-range, and wide overview.")
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
      const manifestEvidence = await uploadEvidence("task-manifest", manifestBlob, taskCoords, {
        extension: "json",
      })

      await completeOperationalTask({
        taskId: selectedTaskId,
        evidencePath: manifestEvidence.filePath,
        evidenceHash: manifestEvidence.evidenceHash,
        evidenceMimeType: manifestEvidence.evidenceMimeType,
        evidenceSizeBytes: manifestEvidence.evidenceSizeBytes,
      })
      resetTaskEvidenceCapture()
      setSelectedTaskId(null)
      showToast("success", "Task completed with triple evidence.")
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not complete task."))
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
      setTaskDetailManifestError(extractErrorMessage(error, "Could not load task evidence details."))
    } finally {
      setLoadingTaskDetailManifest(false)
    }
  }

  const handleRegisterPresence = async () => {
    if (!presenceRestaurantId) {
      showToast("info", "Select a restaurant to register supervisor entry/exit.")
      return
    }
    if (!presenceCoords || !presencePhoto) {
      showToast("info", "Supervisor registration requires GPS and photo evidence.")
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
      showToast("success", "Supervisor presence registered.")
      await loadPresenceLogs()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not register supervisor presence."))
    } finally {
      setRegisteringPresence(false)
    }
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <Card title="Shifts" subtitle="Employee operation and supervision in one module." />

        {canOperateEmployee && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Employee operations</h2>

            {loadingData ? (
              <Skeleton className="h-24" />
            ) : activeShift ? (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Active shift since <b>{formatDateTime(activeShift.start_time)}</b>
                  </span>
                  <Badge variant="success">Active</Badge>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                You do not have active shifts at this moment.
              </div>
            )}

            {pendingEmployeeTasks.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">
                  Operational alert: you have {pendingEmployeeTasks.length} task(s) assigned by supervisor.
                </p>
                <p className="mt-1 text-amber-800">
                  You must close each task with 3 specific evidence shots: close-up, mid-range shot, and wide overview.
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

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="GPS location" subtitle="You must have valid coordinates to execute actions.">
                <div className="mt-3">
                  <GPSGuard onLocation={setCoords} />
                </div>
              </Card>

              <Card title="Photo evidence" subtitle="Photo is captured with camera and uploaded to Storage.">
                <div className="mt-3">
                  <CameraCapture onCapture={setPhoto} overlayLines={shiftOverlayLines} />
                </div>
              </Card>
            </div>

            <Card
              title="Main action"
              subtitle={activeShift ? "End active shift" : "Start new shift"}
            >
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-medium text-slate-800">
                  {activeShift
                    ? "Did you finish the shift in good condition?"
                    : "Are you starting in good condition?"}
                </p>
                <div className="mt-2 flex gap-4">
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
                    <span>Yes</span>
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
                    <span>No</span>
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
                    placeholder="Describe health condition or incident."
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
                      ? "Final observation (optional)"
                      : "Initial observation (optional)"
                  }
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {!activeShift ? (
                  <Button onClick={handleStart} disabled={!canSubmit} variant="primary">
                    {processing ? "Starting..." : "Start shift"}
                  </Button>
                ) : (
                  <Button onClick={handleEnd} disabled={!canSubmit} variant="danger">
                    {processing ? "Ending..." : "End shift"}
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

            {activeShift && (
              <Card title="Register incident" subtitle="If anything happens during the shift, register it here.">
                <div className="space-y-2">
                  <textarea
                    value={employeeIncident}
                    onChange={event => setEmployeeIncident(event.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
                    placeholder="Describe the note or incident..."
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={creatingEmployeeIncident}
                    onClick={() => void handleCreateEmployeeIncident()}
                  >
                    {creatingEmployeeIncident ? "Saving..." : "Save note"}
                  </Button>
                </div>
              </Card>
            )}

            <Card title="Assigned tasks" subtitle="Supervision operational tasks with mandatory evidence closure.">
              {loadingTasks ? (
                <Skeleton className="h-24" />
              ) : employeeTasks.length === 0 ? (
                <p className="text-sm text-slate-500">There are no pending assigned tasks.</p>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {employeeTasks.map(task => (
                      <div key={task.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <p className="font-semibold text-slate-800">{task.title}</p>
                        <p className="mt-1 text-slate-600">{task.description}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Priority: {task.priority} | Status: {task.status} | Created: {formatDateTime(task.created_at)}
                        </p>
                        <div className="mt-2 flex gap-2">
                          {task.status === "pending" && (
                            <Button size="sm" variant="secondary" onClick={() => void handleSetTaskInProgress(task.id)}>
                              Start task
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
                              {selectedTaskId === task.id ? "Selected" : "Select to complete"}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedTaskId && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-medium text-slate-700">
                        Task closing evidence (Task #{selectedTaskId})
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Required: GPS + 3 photos (close-up, mid-range, wide overview).
                      </p>

                      <div className="mt-3">
                        <GPSGuard onLocation={setTaskCoords} />
                      </div>

                      <div className="mt-3 grid gap-3 xl:grid-cols-3">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-700">{TASK_EVIDENCE_SHOTS[0].label}</p>
                          <p className="mb-2 text-xs text-slate-500">{TASK_EVIDENCE_SHOTS[0].helper}</p>
                          <CameraCapture
                            onCapture={setTaskPhotoClose}
                            overlayLines={[
                              `User: ${currentUserId ?? "unknown"}`,
                              `Task: ${selectedTaskId}`,
                              "Shot: close_up",
                              taskCoords
                                ? `GPS: ${taskCoords.lat.toFixed(6)}, ${taskCoords.lng.toFixed(6)}`
                                : "GPS: pending",
                            ]}
                          />
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-700">{TASK_EVIDENCE_SHOTS[1].label}</p>
                          <p className="mb-2 text-xs text-slate-500">{TASK_EVIDENCE_SHOTS[1].helper}</p>
                          <CameraCapture
                            onCapture={setTaskPhotoMid}
                            overlayLines={[
                              `User: ${currentUserId ?? "unknown"}`,
                              `Task: ${selectedTaskId}`,
                              "Shot: mid_range",
                              taskCoords
                                ? `GPS: ${taskCoords.lat.toFixed(6)}, ${taskCoords.lng.toFixed(6)}`
                                : "GPS: pending",
                            ]}
                          />
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-700">{TASK_EVIDENCE_SHOTS[2].label}</p>
                          <p className="mb-2 text-xs text-slate-500">{TASK_EVIDENCE_SHOTS[2].helper}</p>
                          <CameraCapture
                            onCapture={setTaskPhotoWide}
                            overlayLines={[
                              `User: ${currentUserId ?? "unknown"}`,
                              `Task: ${selectedTaskId}`,
                              "Shot: wide_general",
                              taskCoords
                                ? `GPS: ${taskCoords.lat.toFixed(6)}, ${taskCoords.lng.toFixed(6)}`
                                : "GPS: pending",
                            ]}
                          />
                        </div>
                      </div>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                        <p>GPS: {taskCoords ? "OK" : "Pending"}</p>
                        <p>Close-up: {taskPhotoClose ? "OK" : "Pending"}</p>
                        <p>Mid-range shot: {taskPhotoMid ? "OK" : "Pending"}</p>
                        <p>Wide overview: {taskPhotoWide ? "OK" : "Pending"}</p>
                      </div>

                      <div className="mt-3">
                        <Button variant="primary" onClick={() => void handleCompleteTask()} disabled={processingTask}>
                          {processingTask ? "Completing..." : "Complete task with triple evidence"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card title="Shift history" subtitle="Paginated view with status and duration.">
              {loadingData ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-10" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <EmptyState
                  title="No history"
                  description="When you register shifts, they will appear here."
                  actionLabel="Reload"
                  onAction={() => void loadEmployeeData(historyPage)}
                />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="pb-2 pr-3">Start</th>
                          <th className="pb-2 pr-3">End</th>
                          <th className="pb-2 pr-3">Status</th>
                          <th className="pb-2 pr-3">Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(shift => (
                          <tr key={shift.id} className="border-b border-slate-100 text-sm text-slate-700">
                            <td className="py-2 pr-3">{formatDateTime(shift.start_time)}</td>
                            <td className="py-2 pr-3">{formatDateTime(shift.end_time)}</td>
                            <td className="py-2 pr-3">
                              <Badge variant={shift.end_time ? "neutral" : "success"}>
                                {shift.end_time ? "Completed" : "Active"}
                              </Badge>
                            </td>
                            <td className="py-2 pr-3">{formatDuration(shift.start_time, shift.end_time)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-slate-500">
                      Page {historyPage} of {historyTotalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={historyPage <= 1 || loadingData}
                        onClick={() => setHistoryPage(prev => Math.max(1, prev - 1))}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={historyPage >= historyTotalPages || loadingData}
                        onClick={() => setHistoryPage(prev => prev + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>

            <Card title="Scheduled shifts" subtitle="Agenda assigned for your upcoming work periods.">
              {scheduledShifts.length === 0 ? (
                <p className="text-sm text-slate-500">You do not have scheduled shifts.</p>
              ) : (
                <div className="space-y-2">
                  {scheduledShifts.map(item => (
                    <div key={item.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      {formatDateTime(item.scheduled_start)} - {formatDateTime(item.scheduled_end)} |{" "}
                      Status: {item.status}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>
        )}

        {canOperateSupervisor && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Supervision panel</h2>

            {(overdueSupervisorTasks.length > 0 || pendingPresenceClosures.length > 0) && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                {overdueSupervisorTasks.length > 0 && (
                  <p className="font-medium">
                    There are {overdueSupervisorTasks.length} overdue task(s) pending closure.
                  </p>
                )}
                {pendingPresenceClosures.length > 0 && (
                  <p className="mt-1">
                    You have {pendingPresenceClosures.length} restaurant(s) with entry registered but no exit today.
                  </p>
                )}
              </div>
            )}

            <Card title="Supervisor entry/exit" subtitle="Mandatory record by restaurant with GPS + evidence.">
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  <select
                    value={presenceRestaurantId ?? ""}
                    onChange={event => setPresenceRestaurantId(Number(event.target.value) || null)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select restaurant</option>
                    {presenceRestaurants.map(restaurant => (
                      <option key={restaurant.id} value={restaurant.id}>
                        {restaurant.name}
                      </option>
                    ))}
                  </select>

                  {presenceRestaurants.length === 0 && (
                    <p className="text-xs text-amber-700">
                      No assigned restaurants to register presence.
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
                      Entry
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="presence-phase"
                        checked={presencePhase === "end"}
                        onChange={() => setPresencePhase("end")}
                      />
                      Exit
                    </label>
                  </div>

                  <textarea
                    rows={2}
                    value={presenceNotes}
                    onChange={event => setPresenceNotes(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Presence notes (optional)"
                  />
                </div>

                <div className="space-y-3">
                  <GPSGuard onLocation={setPresenceCoords} />
                  <CameraCapture
                    onCapture={setPresencePhoto}
                    overlayLines={[
                      `User: ${currentUserId ?? "unknown"}`,
                      `Supervisor phase: ${presencePhase}`,
                      presenceCoords
                        ? `GPS: ${presenceCoords.lat.toFixed(6)}, ${presenceCoords.lng.toFixed(6)}`
                        : "GPS: pending",
                    ]}
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={() => void handleRegisterPresence()} disabled={registeringPresence}>
                  {registeringPresence ? "Saving..." : "Register supervisor presence"}
                </Button>
                <span className="text-xs text-slate-500">
                  Latest records: {supervisorPresence.length}
                </span>
              </div>

              {supervisorPresence.length > 0 && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="mb-2 font-medium text-slate-700">Recent presence history</p>
                  <ul className="space-y-1 text-slate-600">
                    {supervisorPresence.slice(0, 6).map(item => (
                      <li key={item.id}>
                        {formatDateTime(item.recorded_at)} | Restaurant #{item.restaurant_id} | Phase: {item.phase}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            <Card title="Task monitoring" subtitle="Recent tasks created or assigned in supervised restaurants.">
              {loadingTasks ? (
                <Skeleton className="h-20" />
              ) : supervisorTasks.length === 0 ? (
                <p className="text-sm text-slate-500">There are no operational tasks recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {supervisorTasks.slice(0, 8).map(task => (
                    <div key={task.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <p className="font-medium text-slate-800">
                        #{task.id} {task.title}
                      </p>
                      <p className="text-slate-600">Status: {task.status} | Priority: {task.priority}</p>
                      <p className="text-xs text-slate-500">
                        Employee: {task.assigned_employee_id.slice(0, 8)} | Shift: {task.shift_id}
                      </p>
                      {task.due_at && (
                        <p className="text-xs text-slate-500">Due: {formatDateTime(task.due_at)}</p>
                      )}
                      {task.status === "completed" && task.evidence_path && (
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleOpenTaskDetail(task)}
                          >
                            View evidence details
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {loadingSupervisor ? (
              <Skeleton className="h-40" />
            ) : supervisorRows.length === 0 ? (
              <EmptyState
                title="No active shifts"
                description="When there is activity in progress, you will see it here."
                actionLabel="Refresh"
                onAction={() => void loadSupervisorData()}
              />
            ) : (
              <div className="space-y-3">
                {supervisorRows.map(row => {
                  return (
                    <Card
                      key={row.id}
                      title={`Shift ${String(row.id).slice(0, 8)}`}
                      subtitle={`Start: ${formatDateTime(row.start_time)} | Status: ${row.status}`}
                    >
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 p-3 text-sm">
                          <p className="font-medium text-slate-700">Start evidence</p>
                          {row.start_evidence_path ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                void (async () => {
                                  try {
                                    const signedUrl = await resolveEvidenceUrl(row.start_evidence_path)
                                    if (!signedUrl) {
                                      showToast("info", "Could not generate evidence URL.")
                                      return
                                    }
                                    window.open(signedUrl, "_blank", "noopener,noreferrer")
                                  } catch (error: unknown) {
                                    showToast("error", extractErrorMessage(error, "Could not open evidence."))
                                  }
                                })()
                              }}
                            >
                              View start evidence
                            </Button>
                          ) : (
                            <p className="text-slate-500">No evidence registered.</p>
                          )}
                        </div>
                        <div className="rounded-lg border border-slate-200 p-3 text-sm">
                          <p className="font-medium text-slate-700">End evidence</p>
                          {row.end_evidence_path ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                void (async () => {
                                  try {
                                    const signedUrl = await resolveEvidenceUrl(row.end_evidence_path)
                                    if (!signedUrl) {
                                      showToast("info", "Could not generate evidence URL.")
                                      return
                                    }
                                    window.open(signedUrl, "_blank", "noopener,noreferrer")
                                  } catch (error: unknown) {
                                    showToast("error", extractErrorMessage(error, "Could not open evidence."))
                                  }
                                })()
                              }}
                            >
                              View end evidence
                            </Button>
                          ) : (
                            <p className="text-slate-500">Closure pending.</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void handleStatusChange(row.id, "approved")}>
                          Approve
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => void handleStatusChange(row.id, "rejected")}>
                          Reject
                        </Button>
                      </div>

                      <div className="mt-4 space-y-2 rounded-lg border border-slate-200 p-3">
                        <p className="text-sm font-medium text-slate-700">Create task for this shift</p>
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
                          placeholder="Task title"
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
                          placeholder="Instructions. Include closing criteria: close-up + mid-range + wide overview."
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
                            <option value="low">Low</option>
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                            <option value="critical">Critical</option>
                          </select>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => void handleCreateTaskForShift(row)}
                            disabled={creatingTaskForShift === row.id}
                          >
                            {creatingTaskForShift === row.id ? "Saving..." : "Create task"}
                          </Button>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2">
                        <label className="text-sm font-medium text-slate-700">Register incident</label>
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
                          placeholder="Describe the observed incident..."
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void handleCreateIncident(row.id)}
                        >
                          Save incident
                        </Button>
                      </div>

                      {(incidentHistory[row.id] ?? []).length > 0 && (
                        <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
                          <p className="mb-2 font-medium text-slate-700">Recent incidents</p>
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
              Task evidence detail{" "}
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
                            showToast("info", "Could not open evidence file.")
                            return
                          }
                          window.open(signedUrl, "_blank", "noopener,noreferrer")
                        } catch (error: unknown) {
                          showToast("error", extractErrorMessage(error, "Could not open evidence file."))
                        }
                      })()
                    }}
                  >
                    Open evidence file
                  </Button>
                )}
              </div>
            ) : !taskDetailManifest ? (
              <p className="text-sm text-slate-600">No evidence detail available.</p>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <p>Captured: {formatDateTime(taskDetailManifest.capturedAt)}</p>
                  <p>User: {taskDetailManifest.capturedBy ?? "-"}</p>
                  <p>
                    GPS:{" "}
                    {taskDetailManifest.gps
                      ? `${taskDetailManifest.gps.lat.toFixed(6)}, ${taskDetailManifest.gps.lng.toFixed(6)}`
                      : "-"}
                  </p>
                  <p>Evidences: {taskDetailManifest.evidences.length}</p>
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
                          alt={`Evidence ${item.label}`}
                          className="mt-2 h-48 w-full rounded-lg border border-slate-200 object-cover"
                        />
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">Could not resolve URL for this evidence.</p>
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
                        showToast("info", "No manifest URL available.")
                        return
                      }
                      window.open(taskDetailManifest.manifestSignedUrl, "_blank", "noopener,noreferrer")
                    }}
                  >
                    View JSON manifest
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



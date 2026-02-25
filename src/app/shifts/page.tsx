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

const HISTORY_PAGE_SIZE = 8
const TASK_EVIDENCE_SHOTS = [
  { key: "close_up", label: "Primer plano", helper: "Toma detalle directo del area intervenida." },
  { key: "mid_range", label: "Plano medio", helper: "Toma a distancia media mostrando contexto cercano." },
  { key: "wide_general", label: "Vista general", helper: "Toma panoramica final del espacio completo." },
] as const
const TASK_SHOT_ORDER: Record<string, number> = {
  close_up: 1,
  mid_range: 2,
  wide_general: 3,
}

type TaskEvidenceShotKey = (typeof TASK_EVIDENCE_SHOTS)[number]["key"]

function formatDateTime(value: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  return date.toLocaleString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

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
  return message.includes("consent") || message.includes("legal") || message.includes("tratamiento de datos")
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
  const { showToast } = useToast()

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
    if (!coords) blockers.push("Debes capturar ubicacion GPS.")
    if (!photo) blockers.push("Debes capturar evidencia fotografica.")
    if (!healthAnswered) {
      blockers.push(
        activeShift
          ? "Debes responder la condicion de salud de salida."
          : "Debes responder la condicion de salud de ingreso."
      )
    }
    if (healthDeclarationRequired && !healthDeclarationProvided) {
      blockers.push("Debes registrar una declaracion cuando la condicion de salud no sea optima.")
    }
    if (processing) blockers.push("Hay una accion en progreso.")
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
    `Usuario: ${currentUserId ?? "desconocido"}`,
    `Fase: ${activeShift ? "salida-turno" : "ingreso-turno"}`,
    coords ? `GPS: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : "GPS: pendiente",
  ]

  const loadEmployeeData = useCallback(async (page: number) => {
    setLoadingData(true)
    try {
      const [active, historyResult, scheduledResult] = await Promise.all([
        getMyActiveShift(),
        getMyShiftHistory(page, HISTORY_PAGE_SIZE),
        listMyScheduledShifts(6),
      ])
      setActiveShift(active)
      setHistory(historyResult.rows)
      setHistoryTotalPages(historyResult.totalPages)
      setScheduledShifts(scheduledResult)
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "No se pudo cargar la informacion de turnos."))
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
      showToast("error", extractErrorMessage(error, "No se pudieron cargar los turnos activos."))
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
              name: item.name ?? `Restaurante #${item.id}`,
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
      showToast("error", extractErrorMessage(error, "No se pudo cargar restaurantes para presencia de supervisora."))
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
      showToast("error", extractErrorMessage(error, "No se pudieron cargar las tareas operativas."))
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
      showToast("error", extractErrorMessage(error, "No se pudieron cargar los registros de presencia de supervisora."))
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
    if (!currentUserId) throw new Error("No se encontro usuario autenticado.")
    const timestamp = new Date().toISOString().replaceAll(":", "-")
    const coordTag = `${position.lat.toFixed(6)}_${position.lng.toFixed(6)}`
    const rawExtension = (options?.extension ?? "jpg").replace(/^\./, "").toLowerCase()
    const extension = rawExtension.length > 0 ? rawExtension : "jpg"
    const fileName = `${prefix}-${timestamp}-${coordTag}.${extension}`
    const filePath = `users/${currentUserId}/${prefix}/${fileName}`

    const evidenceHash = await sha256Hex(blob)
    const evidenceMimeType = blob.type || "image/jpeg"
    const evidenceSizeBytes = blob.size

    const { error } = await supabase.storage.from("shift-evidence").upload(filePath, blob, {
      upsert: false,
      contentType: evidenceMimeType,
    })
    if (error) throw error
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
      if (startFitForWork === null) throw new Error("Debes confirmar si ingresas en optimas condiciones para laborar.")

      const latestActive = await getMyActiveShift()
      if (latestActive) {
        setActiveShift(latestActive)
        throw new Error("Ya existe un turno activo. Debes finalizarlo antes de iniciar otro.")
      }

      if (!photo) throw new Error("Debes capturar evidencia fotografica.")
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

      showToast("success", "Turno iniciado correctamente.")
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
        showToast("error", "Consentimiento pendiente: acepta tratamiento de datos para operar turnos.")
        return
      }
      showToast("error", extractErrorMessage(error, "No se pudo iniciar el turno."))
    } finally {
      setProcessing(false)
    }
  }

  const handleEnd = async () => {
    if (!canSubmit || !coords || !activeShift) return
    setProcessing(true)

    try {
      if (endFitForWork === null) throw new Error("Debes confirmar tu condicion al finalizar turno.")
      if (!endFitForWork && !endHealthDeclaration.trim()) {
        throw new Error("Debes describir incidentes si tu condicion de salida no es optima.")
      }

      if (!photo) throw new Error("Debes capturar evidencia fotografica.")
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

      showToast("success", "Turno finalizado correctamente.")
      resetEvidenceAndLocation()
      setEndObservation("")
      setEndFitForWork(null)
      setEndHealthDeclaration("")
      setHistoryPage(1)
      await loadEmployeeData(1)
      await loadSupervisorData()
    } catch (error: unknown) {
      if (isConsentPendingError(error)) {
        showToast("error", "Consentimiento pendiente: acepta tratamiento de datos para operar turnos.")
        return
      }
      showToast("error", extractErrorMessage(error, "No se pudo finalizar el turno."))
    } finally {
      setProcessing(false)
    }
  }

  const handleStatusChange = async (shiftId: string, status: string) => {
    try {
      await updateShiftStatus(shiftId, status)
      showToast("success", `Turno actualizado a ${status}.`)
      await loadSupervisorData()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "No se pudo actualizar el estado del turno."))
    }
  }

  const handleCreateIncident = async (shiftId: string) => {
    const note = (incidentNotes[shiftId] ?? "").trim()
    if (!note) {
      showToast("info", "Escribe una novedad antes de guardar.")
      return
    }

    try {
      const incident = await createShiftIncident(shiftId, note)
      setIncidentNotes(prev => ({ ...prev, [shiftId]: "" }))
      setIncidentHistory(prev => ({
        ...prev,
        [shiftId]: [incident, ...(prev[shiftId] ?? [])],
      }))
      showToast("success", "Novedad guardada.")
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "No se pudo guardar la novedad."))
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
      showToast("info", "Escribe una nota antes de guardar.")
      return
    }

    setCreatingEmployeeIncident(true)
    try {
      await createShiftIncident(activeShift.id, `[EMPLEADO] ${note}`)
      setEmployeeIncident("")
      showToast("success", "Nota guardada correctamente.")
      await loadSupervisorData()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "No se pudo guardar la nota."))
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
      showToast("info", "El titulo y la descripcion de la tarea son obligatorios.")
      return
    }
    if (!row.restaurant_id || !row.employee_id) {
      showToast("error", "El turno no tiene relacion restaurante/empleado.")
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
      showToast("success", "Tarea operativa creada.")
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "No se pudo crear la tarea."))
    } finally {
      setCreatingTaskForShift(null)
    }
  }

  const handleSetTaskInProgress = async (taskId: number) => {
    try {
      await markTaskInProgress(taskId)
      showToast("success", "Tarea marcada en progreso.")
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "No se pudo actualizar el estado de la tarea."))
    }
  }

  const handleCompleteTask = async () => {
    if (!selectedTaskId) {
      showToast("info", "Selecciona una tarea para completar.")
      return
    }
    if (!taskCoords || !taskPhotoClose || !taskPhotoMid || !taskPhotoWide) {
      showToast("info", "Completar tarea requiere GPS y 3 evidencias: primer plano, plano medio y vista general.")
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
      showToast("success", "Tarea completada con evidencia triple.")
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "No se pudo completar la tarea."))
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
      setTaskDetailManifestError(extractErrorMessage(error, "No se pudo cargar detalle de evidencia de la tarea."))
    } finally {
      setLoadingTaskDetailManifest(false)
    }
  }

  const handleRegisterPresence = async () => {
    if (!presenceRestaurantId) {
      showToast("info", "Selecciona restaurante para registro de ingreso/salida de supervisora.")
      return
    }
    if (!presenceCoords || !presencePhoto) {
      showToast("info", "El registro de supervisora requiere GPS y evidencia fotografica.")
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
      showToast("success", "Presencia de supervisora registrada.")
      await loadPresenceLogs()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "No se pudo registrar presencia de supervisora."))
    } finally {
      setRegisteringPresence(false)
    }
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <Card title="Turnos" subtitle="Operacion de empleado y supervision en un solo modulo." />

        {canOperateEmployee && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Operacion de empleado</h2>

            {loadingData ? (
              <Skeleton className="h-24" />
            ) : activeShift ? (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Turno activo desde <b>{formatDateTime(activeShift.start_time)}</b>
                  </span>
                  <Badge variant="success">Activo</Badge>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                No tienes turnos activos en este momento.
              </div>
            )}

            {pendingEmployeeTasks.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">
                  Alerta operativa: tienes {pendingEmployeeTasks.length} tarea(s) asignada(s) por supervisora.
                </p>
                <p className="mt-1 text-amber-800">
                  Debes cerrar cada tarea con evidencia especifica de 3 tomas: primer plano, plano medio y vista general.
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
              <Card title="Ubicacion GPS" subtitle="Debes tener coordenadas validas para ejecutar acciones.">
                <div className="mt-3">
                  <GPSGuard onLocation={setCoords} />
                </div>
              </Card>

              <Card title="Evidencia fotografica" subtitle="La foto se captura con camara y se sube a Storage.">
                <div className="mt-3">
                  <CameraCapture onCapture={setPhoto} overlayLines={shiftOverlayLines} />
                </div>
              </Card>
            </div>

            <Card
              title="Accion principal"
              subtitle={activeShift ? "Finalizar turno activo" : "Iniciar nuevo turno"}
            >
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-medium text-slate-800">
                  {activeShift
                    ? "¿Salio bien del turno?"
                    : "¿Ingresa en optimas condiciones?"}
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
                    <span>Si</span>
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
                    placeholder="Describe condicion de salud o incidente."
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
                      ? "Observacion final (opcional)"
                      : "Observacion inicial (opcional)"
                  }
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {!activeShift ? (
                  <Button onClick={handleStart} disabled={!canSubmit} variant="primary">
                    {processing ? "Iniciando..." : "Iniciar turno"}
                  </Button>
                ) : (
                  <Button onClick={handleEnd} disabled={!canSubmit} variant="danger">
                    {processing ? "Finalizando..." : "Finalizar turno"}
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
              <Card title="Registrar novedad" subtitle="Si ocurre algo durante el turno, registralo aqui.">
                <div className="space-y-2">
                  <textarea
                    value={employeeIncident}
                    onChange={event => setEmployeeIncident(event.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
                    placeholder="Describe la nota o novedad..."
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={creatingEmployeeIncident}
                    onClick={() => void handleCreateEmployeeIncident()}
                  >
                    {creatingEmployeeIncident ? "Guardando..." : "Guardar nota"}
                  </Button>
                </div>
              </Card>
            )}

            <Card title="Tareas asignadas" subtitle="Tareas operativas de supervision con cierre obligatorio por evidencia.">
              {loadingTasks ? (
                <Skeleton className="h-24" />
              ) : employeeTasks.length === 0 ? (
                <p className="text-sm text-slate-500">No hay tareas pendientes asignadas.</p>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {employeeTasks.map(task => (
                      <div key={task.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <p className="font-semibold text-slate-800">{task.title}</p>
                        <p className="mt-1 text-slate-600">{task.description}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Prioridad: {task.priority} | Estado: {task.status} | Creada: {formatDateTime(task.created_at)}
                        </p>
                        <div className="mt-2 flex gap-2">
                          {task.status === "pending" && (
                            <Button size="sm" variant="secondary" onClick={() => void handleSetTaskInProgress(task.id)}>
                              Iniciar tarea
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
                              {selectedTaskId === task.id ? "Seleccionada" : "Seleccionar para completar"}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedTaskId && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-medium text-slate-700">
                        Evidencia de cierre de tarea (Tarea #{selectedTaskId})
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Requerido: GPS + 3 fotos (primer plano, plano medio y vista general).
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
                              `Usuario: ${currentUserId ?? "desconocido"}`,
                              `Tarea: ${selectedTaskId}`,
                              "Toma: primer_plano",
                              taskCoords
                                ? `GPS: ${taskCoords.lat.toFixed(6)}, ${taskCoords.lng.toFixed(6)}`
                                : "GPS: pendiente",
                            ]}
                          />
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-700">{TASK_EVIDENCE_SHOTS[1].label}</p>
                          <p className="mb-2 text-xs text-slate-500">{TASK_EVIDENCE_SHOTS[1].helper}</p>
                          <CameraCapture
                            onCapture={setTaskPhotoMid}
                            overlayLines={[
                              `Usuario: ${currentUserId ?? "desconocido"}`,
                              `Tarea: ${selectedTaskId}`,
                              "Toma: plano_medio",
                              taskCoords
                                ? `GPS: ${taskCoords.lat.toFixed(6)}, ${taskCoords.lng.toFixed(6)}`
                                : "GPS: pendiente",
                            ]}
                          />
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-700">{TASK_EVIDENCE_SHOTS[2].label}</p>
                          <p className="mb-2 text-xs text-slate-500">{TASK_EVIDENCE_SHOTS[2].helper}</p>
                          <CameraCapture
                            onCapture={setTaskPhotoWide}
                            overlayLines={[
                              `Usuario: ${currentUserId ?? "desconocido"}`,
                              `Tarea: ${selectedTaskId}`,
                              "Toma: vista_general",
                              taskCoords
                                ? `GPS: ${taskCoords.lat.toFixed(6)}, ${taskCoords.lng.toFixed(6)}`
                                : "GPS: pendiente",
                            ]}
                          />
                        </div>
                      </div>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                        <p>GPS: {taskCoords ? "OK" : "Pendiente"}</p>
                        <p>Primer plano: {taskPhotoClose ? "OK" : "Pendiente"}</p>
                        <p>Plano medio: {taskPhotoMid ? "OK" : "Pendiente"}</p>
                        <p>Vista general: {taskPhotoWide ? "OK" : "Pendiente"}</p>
                      </div>

                      <div className="mt-3">
                        <Button variant="primary" onClick={() => void handleCompleteTask()} disabled={processingTask}>
                          {processingTask ? "Completando..." : "Completar tarea con evidencia triple"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card title="Historial de turnos" subtitle="Vista paginada con estado y duracion.">
              {loadingData ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-10" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <EmptyState
                  title="Sin historial"
                  description="Cuando registres turnos, apareceran aqui."
                  actionLabel="Recargar"
                  onAction={() => void loadEmployeeData(historyPage)}
                />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="pb-2 pr-3">Inicio</th>
                          <th className="pb-2 pr-3">Fin</th>
                          <th className="pb-2 pr-3">Estado</th>
                          <th className="pb-2 pr-3">Duracion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(shift => (
                          <tr key={shift.id} className="border-b border-slate-100 text-sm text-slate-700">
                            <td className="py-2 pr-3">{formatDateTime(shift.start_time)}</td>
                            <td className="py-2 pr-3">{formatDateTime(shift.end_time)}</td>
                            <td className="py-2 pr-3">
                              <Badge variant={shift.end_time ? "neutral" : "success"}>
                                {shift.end_time ? "Finalizado" : "Activo"}
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
                      Pagina {historyPage} de {historyTotalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={historyPage <= 1 || loadingData}
                        onClick={() => setHistoryPage(prev => Math.max(1, prev - 1))}
                      >
                        Anterior
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={historyPage >= historyTotalPages || loadingData}
                        onClick={() => setHistoryPage(prev => prev + 1)}
                      >
                        Siguiente
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>

            <Card title="Turnos programados" subtitle="Agenda asignada para tus proximos periodos de trabajo.">
              {scheduledShifts.length === 0 ? (
                <p className="text-sm text-slate-500">No tienes turnos programados.</p>
              ) : (
                <div className="space-y-2">
                  {scheduledShifts.map(item => (
                    <div key={item.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      {formatDateTime(item.scheduled_start)} - {formatDateTime(item.scheduled_end)} |{" "}
                      Estado: {item.status}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>
        )}

        {canOperateSupervisor && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Panel de supervision</h2>

            {(overdueSupervisorTasks.length > 0 || pendingPresenceClosures.length > 0) && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                {overdueSupervisorTasks.length > 0 && (
                  <p className="font-medium">
                    Hay {overdueSupervisorTasks.length} tarea(s) vencida(s) pendientes de cierre.
                  </p>
                )}
                {pendingPresenceClosures.length > 0 && (
                  <p className="mt-1">
                    Tienes {pendingPresenceClosures.length} restaurante(s) con ingreso sin registrar salida hoy.
                  </p>
                )}
              </div>
            )}

            <Card title="Ingreso/salida supervisora" subtitle="Registro obligatorio por restaurante con GPS + evidencia.">
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  <select
                    value={presenceRestaurantId ?? ""}
                    onChange={event => setPresenceRestaurantId(Number(event.target.value) || null)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Seleccionar restaurante</option>
                    {presenceRestaurants.map(restaurant => (
                      <option key={restaurant.id} value={restaurant.id}>
                        {restaurant.name}
                      </option>
                    ))}
                  </select>

                  {presenceRestaurants.length === 0 && (
                    <p className="text-xs text-amber-700">
                      No hay restaurantes asignados para registrar presencia.
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
                      Ingreso
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="presence-phase"
                        checked={presencePhase === "end"}
                        onChange={() => setPresencePhase("end")}
                      />
                      Salida
                    </label>
                  </div>

                  <textarea
                    rows={2}
                    value={presenceNotes}
                    onChange={event => setPresenceNotes(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Notas de presencia (opcional)"
                  />
                </div>

                <div className="space-y-3">
                  <GPSGuard onLocation={setPresenceCoords} />
                  <CameraCapture
                    onCapture={setPresencePhoto}
                    overlayLines={[
                      `Usuario: ${currentUserId ?? "desconocido"}`,
                      `Fase supervisora: ${presencePhase}`,
                      presenceCoords
                        ? `GPS: ${presenceCoords.lat.toFixed(6)}, ${presenceCoords.lng.toFixed(6)}`
                        : "GPS: pendiente",
                    ]}
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={() => void handleRegisterPresence()} disabled={registeringPresence}>
                  {registeringPresence ? "Guardando..." : "Registrar presencia de supervisora"}
                </Button>
                <span className="text-xs text-slate-500">
                  Ultimos registros: {supervisorPresence.length}
                </span>
              </div>

              {supervisorPresence.length > 0 && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="mb-2 font-medium text-slate-700">Historial reciente de presencia</p>
                  <ul className="space-y-1 text-slate-600">
                    {supervisorPresence.slice(0, 6).map(item => (
                      <li key={item.id}>
                        {formatDateTime(item.recorded_at)} | Restaurante #{item.restaurant_id} | Fase: {item.phase}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            <Card title="Monitoreo de tareas" subtitle="Tareas recientes creadas o asignadas en restaurantes supervisados.">
              {loadingTasks ? (
                <Skeleton className="h-20" />
              ) : supervisorTasks.length === 0 ? (
                <p className="text-sm text-slate-500">Aun no hay tareas operativas registradas.</p>
              ) : (
                <div className="space-y-2">
                  {supervisorTasks.slice(0, 8).map(task => (
                    <div key={task.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <p className="font-medium text-slate-800">
                        #{task.id} {task.title}
                      </p>
                      <p className="text-slate-600">Estado: {task.status} | Prioridad: {task.priority}</p>
                      <p className="text-xs text-slate-500">
                        Empleado: {task.assigned_employee_id.slice(0, 8)} | Turno: {task.shift_id}
                      </p>
                      {task.due_at && (
                        <p className="text-xs text-slate-500">Vence: {formatDateTime(task.due_at)}</p>
                      )}
                      {task.status === "completed" && task.evidence_path && (
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleOpenTaskDetail(task)}
                          >
                            Ver detalle de evidencia
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
                title="Sin turnos activos"
                description="Cuando haya actividad en progreso, la veras aqui."
                actionLabel="Actualizar"
                onAction={() => void loadSupervisorData()}
              />
            ) : (
              <div className="space-y-3">
                {supervisorRows.map(row => {
                  return (
                    <Card
                      key={row.id}
                      title={`Turno ${String(row.id).slice(0, 8)}`}
                      subtitle={`Inicio: ${formatDateTime(row.start_time)} | Estado: ${row.status}`}
                    >
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 p-3 text-sm">
                          <p className="font-medium text-slate-700">Evidencia de inicio</p>
                          {row.start_evidence_path ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                void (async () => {
                                  try {
                                    const signedUrl = await resolveEvidenceUrl(row.start_evidence_path)
                                    if (!signedUrl) {
                                      showToast("info", "No se pudo generar URL de evidencia.")
                                      return
                                    }
                                    window.open(signedUrl, "_blank", "noopener,noreferrer")
                                  } catch (error: unknown) {
                                    showToast("error", extractErrorMessage(error, "No se pudo abrir la evidencia."))
                                  }
                                })()
                              }}
                            >
                              Ver evidencia de inicio
                            </Button>
                          ) : (
                            <p className="text-slate-500">No hay evidencia registrada.</p>
                          )}
                        </div>
                        <div className="rounded-lg border border-slate-200 p-3 text-sm">
                          <p className="font-medium text-slate-700">Evidencia de salida</p>
                          {row.end_evidence_path ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                void (async () => {
                                  try {
                                    const signedUrl = await resolveEvidenceUrl(row.end_evidence_path)
                                    if (!signedUrl) {
                                      showToast("info", "No se pudo generar URL de evidencia.")
                                      return
                                    }
                                    window.open(signedUrl, "_blank", "noopener,noreferrer")
                                  } catch (error: unknown) {
                                    showToast("error", extractErrorMessage(error, "No se pudo abrir la evidencia."))
                                  }
                                })()
                              }}
                            >
                              Ver evidencia de salida
                            </Button>
                          ) : (
                            <p className="text-slate-500">Cierre pendiente.</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void handleStatusChange(row.id, "approved")}>
                          Aprobar
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => void handleStatusChange(row.id, "rejected")}>
                          Rechazar
                        </Button>
                      </div>

                      <div className="mt-4 space-y-2 rounded-lg border border-slate-200 p-3">
                        <p className="text-sm font-medium text-slate-700">Crear tarea para este turno</p>
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
                          placeholder="Titulo de la tarea"
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
                          placeholder="Instrucciones. Incluye criterio de cierre: primer plano + plano medio + vista general."
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
                            <option value="low">Baja</option>
                            <option value="normal">Normal</option>
                            <option value="high">Alta</option>
                            <option value="critical">Critica</option>
                          </select>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => void handleCreateTaskForShift(row)}
                            disabled={creatingTaskForShift === row.id}
                          >
                            {creatingTaskForShift === row.id ? "Guardando..." : "Crear tarea"}
                          </Button>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2">
                        <label className="text-sm font-medium text-slate-700">Registrar novedad</label>
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
                          placeholder="Describe la novedad observada..."
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void handleCreateIncident(row.id)}
                        >
                          Guardar novedad
                        </Button>
                      </div>

                      {(incidentHistory[row.id] ?? []).length > 0 && (
                        <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
                          <p className="mb-2 font-medium text-slate-700">Novedades recientes</p>
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
              Detalle de evidencia de tarea{" "}
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
                            showToast("info", "No se pudo abrir archivo de evidencia.")
                            return
                          }
                          window.open(signedUrl, "_blank", "noopener,noreferrer")
                        } catch (error: unknown) {
                          showToast("error", extractErrorMessage(error, "No se pudo abrir archivo de evidencia."))
                        }
                      })()
                    }}
                  >
                    Abrir archivo de evidencia
                  </Button>
                )}
              </div>
            ) : !taskDetailManifest ? (
              <p className="text-sm text-slate-600">No hay detalle de evidencia disponible.</p>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <p>Capturada: {formatDateTime(taskDetailManifest.capturedAt)}</p>
                  <p>Usuario: {taskDetailManifest.capturedBy ?? "-"}</p>
                  <p>
                    GPS:{" "}
                    {taskDetailManifest.gps
                      ? `${taskDetailManifest.gps.lat.toFixed(6)}, ${taskDetailManifest.gps.lng.toFixed(6)}`
                      : "-"}
                  </p>
                  <p>Evidencias: {taskDetailManifest.evidences.length}</p>
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
                          alt={`Evidencia ${item.label}`}
                          className="mt-2 h-48 w-full rounded-lg border border-slate-200 object-cover"
                        />
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">No se pudo resolver URL de esta evidencia.</p>
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
                        showToast("info", "No hay URL del manifiesto disponible.")
                        return
                      }
                      window.open(taskDetailManifest.manifestSignedUrl, "_blank", "noopener,noreferrer")
                    }}
                  >
                    Ver manifiesto JSON
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


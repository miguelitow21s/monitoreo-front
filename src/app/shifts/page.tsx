"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import CameraCapture from "@/components/CameraCapture"
import GPSGuard, { Coordinates } from "@/components/GPSGuard"
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
  listMyOperationalTasks,
  listSupervisorOperationalTasks,
  markTaskInProgress,
  OperationalTask,
  TaskPriority,
} from "@/services/tasks.service"

const HISTORY_PAGE_SIZE = 8

function formatDateTime(value: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  return date.toLocaleString("en-US", {
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
  const [taskPhoto, setTaskPhoto] = useState<Blob | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [processingTask, setProcessingTask] = useState(false)
  const [newTaskByShift, setNewTaskByShift] = useState<Record<string, { title: string; description: string; priority: TaskPriority }>>({})
  const [creatingTaskForShift, setCreatingTaskForShift] = useState<string | null>(null)

  const [supervisorPresence, setSupervisorPresence] = useState<SupervisorPresenceLog[]>([])
  const [presenceRestaurantId, setPresenceRestaurantId] = useState<number | null>(null)
  const [presenceCoords, setPresenceCoords] = useState<Coordinates | null>(null)
  const [presencePhoto, setPresencePhoto] = useState<Blob | null>(null)
  const [presenceNotes, setPresenceNotes] = useState("")
  const [presencePhase, setPresencePhase] = useState<"start" | "end">("start")
  const [registeringPresence, setRegisteringPresence] = useState(false)

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
          ? "You must answer end-of-shift health condition."
          : "You must answer start-of-shift health condition."
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
        listMyScheduledShifts(6),
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

  useEffect(() => {
    if (!canOperateEmployee) return
    void loadEmployeeData(historyPage)
  }, [historyPage, canOperateEmployee, loadEmployeeData])

  useEffect(() => {
    if (!canOperateSupervisor) return
    void loadSupervisorData()
  }, [canOperateSupervisor, loadSupervisorData])

  useEffect(() => {
    if (presenceRestaurantId) return
    const firstRestaurant = supervisorRows.find(row => typeof row.restaurant_id === "number")?.restaurant_id
    if (firstRestaurant) setPresenceRestaurantId(firstRestaurant)
  }, [supervisorRows, presenceRestaurantId])

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
      if (!presenceRestaurantId && rows[0]?.restaurant_id) {
        setPresenceRestaurantId(rows[0].restaurant_id)
      }
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not load supervisor presence logs."))
    }
  }, [canOperateSupervisor, presenceRestaurantId, showToast])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  useEffect(() => {
    if (!selectedTaskId) return
    if (!employeeTasks.some(task => task.id === selectedTaskId)) {
      setSelectedTaskId(null)
    }
  }, [employeeTasks, selectedTaskId])

  useEffect(() => {
    void loadPresenceLogs()
  }, [loadPresenceLogs])

  const uploadEvidence = async (
    prefix: "shift-start" | "shift-end" | "task" | "supervisor-start" | "supervisor-end",
    blob: Blob,
    position: Coordinates
  ) => {
    if (!currentUserId) throw new Error("Authenticated user not found.")
    const timestamp = new Date().toISOString().replaceAll(":", "-")
    const coordTag = `${position.lat.toFixed(6)}_${position.lng.toFixed(6)}`
    const fileName = `${prefix}-${timestamp}-${coordTag}.jpg`
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

  const handleStart = async () => {
    if (!canSubmit || !coords) return
    setProcessing(true)
    let startedShiftId: number | null = null

    try {
      if (startFitForWork === null) throw new Error("You must confirm if you are in optimal condition to work.")

      const latestActive = await getMyActiveShift()
      if (latestActive) {
        setActiveShift(latestActive)
        throw new Error("An active shift already exists. You must finish it before starting another one.")
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
        await createShiftIncident(String(shiftId), `[START] ${startObservation.trim()}`)
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
        showToast("error", "Consentimiento pendiente: acepta tratamiento de datos para operar turnos.")
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
      if (endFitForWork === null) throw new Error("You must confirm end-of-shift condition.")
      if (!endFitForWork && !endHealthDeclaration.trim()) {
        throw new Error("You must describe incidents if end-of-shift condition is not optimal.")
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
        await createShiftIncident(activeShift.id, `[END] ${endObservation.trim()}`)
      }

      showToast("success", "Shift finished successfully.")
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
      showToast("error", extractErrorMessage(error, "Could not finish shift."))
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
      await createShiftIncident(activeShift.id, `[EMPLOYEE] ${note}`)
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

    if (!title || !description) {
      showToast("info", "Task title and description are required.")
      return
    }
    if (!row.restaurant_id || !row.employee_id) {
      showToast("error", "Shift does not have restaurant/employee relation.")
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
      })
      setNewTaskByShift(prev => ({
        ...prev,
        [row.id]: { title: "", description: "", priority: "normal" },
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
    if (!taskCoords || !taskPhoto) {
      showToast("info", "Task completion requires GPS and photo evidence.")
      return
    }

    setProcessingTask(true)
    try {
      const { filePath, evidenceHash, evidenceMimeType, evidenceSizeBytes } = await uploadEvidence("task", taskPhoto, taskCoords)
      await completeOperationalTask({
        taskId: selectedTaskId,
        evidencePath: filePath,
        evidenceHash,
        evidenceMimeType,
        evidenceSizeBytes,
      })
      setTaskCoords(null)
      setTaskPhoto(null)
      setSelectedTaskId(null)
      showToast("success", "Task completed with evidence.")
      await loadTasks()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not complete task."))
    } finally {
      setProcessingTask(false)
    }
  }

  const handleRegisterPresence = async () => {
    if (!presenceRestaurantId) {
      showToast("info", "Select restaurant for supervisor check-in/out.")
      return
    }
    if (!presenceCoords || !presencePhoto) {
      showToast("info", "Supervisor check-in/out requires GPS and evidence photo.")
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
                You have no active shifts right now.
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="GPS location" subtitle="You must have valid coordinates to run actions.">
                <div className="mt-3">
                  <GPSGuard onLocation={setCoords} />
                </div>
              </Card>

              <Card title="Photo evidence" subtitle="Photo is captured from camera and uploaded to Storage.">
                <div className="mt-3">
                  <CameraCapture onCapture={setPhoto} overlayLines={shiftOverlayLines} />
                </div>
              </Card>
            </div>

            <Card
              title="Main action"
              subtitle={activeShift ? "Finish active shift" : "Start new shift"}
            >
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-medium text-slate-800">
                  {activeShift
                    ? "Do you finish the shift in optimal condition?"
                    : "Do you start the shift in optimal condition?"}
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
                    {processing ? "Finishing..." : "Finish shift"}
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
              <Card title="Report note" subtitle="If something happens during the shift, register it here.">
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

            <Card title="Assigned tasks" subtitle="Operational tasks from supervision with mandatory evidence closure.">
              {loadingTasks ? (
                <Skeleton className="h-24" />
              ) : employeeTasks.length === 0 ? (
                <p className="text-sm text-slate-500">No pending tasks assigned.</p>
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
                              onClick={() => setSelectedTaskId(task.id)}
                            >
                              {selectedTaskId === task.id ? "Selected" : "Select for completion"}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedTaskId && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-medium text-slate-700">Task completion evidence (Task #{selectedTaskId})</p>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <GPSGuard onLocation={setTaskCoords} />
                        <CameraCapture
                          onCapture={setTaskPhoto}
                          overlayLines={[
                            `User: ${currentUserId ?? "unknown"}`,
                            `Task: ${selectedTaskId}`,
                            taskCoords ? `GPS: ${taskCoords.lat.toFixed(6)}, ${taskCoords.lng.toFixed(6)}` : "GPS: pending",
                          ]}
                        />
                      </div>
                      <div className="mt-3">
                        <Button variant="primary" onClick={() => void handleCompleteTask()} disabled={processingTask}>
                          {processingTask ? "Completing..." : "Complete task with evidence"}
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

            <Card title="Scheduled shifts" subtitle="Assigned agenda for your upcoming work periods.">
              {scheduledShifts.length === 0 ? (
                <p className="text-sm text-slate-500">You have no scheduled shifts.</p>
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
            <h2 className="text-lg font-semibold text-slate-900">Supervisor panel</h2>

            <Card title="Supervisor check-in/out" subtitle="Mandatory entry/exit record by restaurant with GPS + evidence.">
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  <select
                    value={presenceRestaurantId ?? ""}
                    onChange={event => setPresenceRestaurantId(Number(event.target.value) || null)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select restaurant</option>
                    {Array.from(
                      new Set(
                        supervisorRows
                          .map(row => row.restaurant_id)
                          .filter((value): value is number => typeof value === "number")
                      )
                    ).map(restaurantId => (
                      <option key={restaurantId} value={restaurantId}>
                        Restaurant #{restaurantId}
                      </option>
                    ))}
                  </select>

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
                  Last records: {supervisorPresence.length}
                </span>
              </div>
            </Card>

            <Card title="Task monitor" subtitle="Recent tasks created or assigned in supervised restaurants.">
              {loadingTasks ? (
                <Skeleton className="h-20" />
              ) : supervisorTasks.length === 0 ? (
                <p className="text-sm text-slate-500">No operational tasks registered yet.</p>
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
                            <p className="text-slate-500">Pending close-out.</p>
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
                              },
                            }))
                          }
                          rows={2}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder="Task instructions and expected evidence..."
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={newTaskByShift[row.id]?.priority ?? "normal"}
                            onChange={event =>
                              setNewTaskByShift(prev => ({
                                ...prev,
                                [row.id]: {
                                  title: prev[row.id]?.title ?? "",
                                  description: prev[row.id]?.description ?? "",
                                  priority: event.target.value as TaskPriority,
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
      </div>
    </ProtectedRoute>
  )
}


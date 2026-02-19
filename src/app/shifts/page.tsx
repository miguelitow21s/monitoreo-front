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
import { listMyScheduledShifts, ScheduledShift } from "@/services/scheduling.service"
import { supabase } from "@/services/supabaseClient"

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
  const [employeeIncident, setEmployeeIncident] = useState("")
  const [creatingEmployeeIncident, setCreatingEmployeeIncident] = useState(false)

  const [supervisorRows, setSupervisorRows] = useState<SupervisorShiftRow[]>([])
  const [loadingSupervisor, setLoadingSupervisor] = useState(false)
  const [incidentNotes, setIncidentNotes] = useState<Record<string, string>>({})
  const [incidentHistory, setIncidentHistory] = useState<Record<string, ShiftIncident[]>>({})

  const canSubmit = !!coords && !!photo && !processing

  const submitBlockers = useMemo(() => {
    const blockers: string[] = []
    if (!coords) blockers.push("You must capture GPS location.")
    if (!photo) blockers.push("You must capture photo evidence.")
    if (processing) blockers.push("There is an action in progress.")
    return blockers
  }, [coords, photo, processing])

  const canOperateEmployee = isEmpleado || isSuperAdmin
  const canOperateSupervisor = isSupervisora || isSuperAdmin

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

  const uploadEvidence = async (prefix: "shift-start" | "shift-end") => {
    if (!photo) throw new Error("You must capture photo evidence.")
    if (!coords) throw new Error("You must capture GPS location before evidence.")

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError) throw userError
    if (!user?.id) throw new Error("Authenticated user not found.")

    const timestamp = new Date().toISOString().replaceAll(":", "-")
    const coordTag = `${coords.lat.toFixed(6)}_${coords.lng.toFixed(6)}`
    const fileName = `${prefix}-${timestamp}-${coordTag}.jpg`
    const filePath = `users/${user.id}/${prefix}/${fileName}`

    const { error } = await supabase.storage.from("shift-evidence").upload(filePath, photo, {
      upsert: false,
      contentType: "image/jpeg",
    })
    if (error) throw error
    return filePath
  }

  const resetEvidenceAndLocation = () => {
    setCoords(null)
    setPhoto(null)
  }

  const handleStart = async () => {
    if (!canSubmit || !coords) return
    setProcessing(true)

    try {
      const latestActive = await getMyActiveShift()
      if (latestActive) {
        setActiveShift(latestActive)
        throw new Error("An active shift already exists. You must finish it before starting another one.")
      }

      const evidencePath = await uploadEvidence("shift-start")
      const shiftId = await startShift({ lat: coords.lat, lng: coords.lng, evidencePath })

      if (startObservation.trim()) {
        await createShiftIncident(String(shiftId), `[START] ${startObservation.trim()}`)
      }

      showToast("success", "Shift started successfully.")
      resetEvidenceAndLocation()
      setStartObservation("")
      setHistoryPage(1)
      await loadEmployeeData(1)
      await loadSupervisorData()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "Could not start shift."))
    } finally {
      setProcessing(false)
    }
  }

  const handleEnd = async () => {
    if (!canSubmit || !coords || !activeShift) return
    setProcessing(true)

    try {
      const evidencePath = await uploadEvidence("shift-end")
      await endShift({
        shiftId: activeShift.id,
        lat: coords.lat,
        lng: coords.lng,
        evidencePath,
      })

      if (endObservation.trim()) {
        await createShiftIncident(activeShift.id, `[END] ${endObservation.trim()}`)
      }

      showToast("success", "Shift finished successfully.")
      resetEvidenceAndLocation()
      setEndObservation("")
      setHistoryPage(1)
      await loadEmployeeData(1)
      await loadSupervisorData()
    } catch (error: unknown) {
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
                  <CameraCapture onCapture={setPhoto} />
                </div>
              </Card>
            </div>

            <Card
              title="Main action"
              subtitle={activeShift ? "Finish active shift" : "Start new shift"}
            >
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


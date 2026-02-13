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

  const [supervisorRows, setSupervisorRows] = useState<SupervisorShiftRow[]>([])
  const [loadingSupervisor, setLoadingSupervisor] = useState(false)
  const [incidentNotes, setIncidentNotes] = useState<Record<string, string>>({})
  const [incidentHistory, setIncidentHistory] = useState<Record<string, ShiftIncident[]>>({})

  const canSubmit = !!coords && !!photo && !processing

  const submitBlockers = useMemo(() => {
    const blockers: string[] = []
    if (!coords) blockers.push("Debes capturar ubicacion GPS.")
    if (!photo) blockers.push("Debes capturar evidencia fotografica.")
    if (processing) blockers.push("Hay una accion en proceso.")
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
      showToast("error", extractErrorMessage(error, "No se pudieron cargar turnos activos."))
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
    if (!photo) throw new Error("Debe capturar evidencia fotografica.")
    if (!coords) throw new Error("Debe capturar ubicacion GPS antes de la evidencia.")

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError) throw userError
    if (!user?.id) throw new Error("No se encontro usuario autenticado.")

    const timestamp = new Date().toISOString().replaceAll(":", "-")
    const coordTag = `${coords.lat.toFixed(6)}_${coords.lng.toFixed(6)}`
    const fileName = `${prefix}-${timestamp}-${coordTag}.jpg`
    const filePath = `users/${user.id}/${prefix}/${fileName}`

    const { error } = await supabase.storage.from("evidence").upload(filePath, photo, {
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
        throw new Error("Ya existe un turno activo. Debes finalizarlo antes de iniciar otro.")
      }

      const evidencePath = await uploadEvidence("shift-start")
      await startShift({ lat: coords.lat, lng: coords.lng, evidencePath })

      showToast("success", "Turno iniciado correctamente.")
      resetEvidenceAndLocation()
      setHistoryPage(1)
      await loadEmployeeData(1)
      await loadSupervisorData()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "No fue posible iniciar el turno."))
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

      showToast("success", "Turno finalizado correctamente.")
      resetEvidenceAndLocation()
      setHistoryPage(1)
      await loadEmployeeData(1)
      await loadSupervisorData()
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "No fue posible finalizar el turno."))
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
      showToast("info", "Escribe una incidencia antes de registrar.")
      return
    }

    try {
      const incident = await createShiftIncident(shiftId, note)
      setIncidentNotes(prev => ({ ...prev, [shiftId]: "" }))
      setIncidentHistory(prev => ({
        ...prev,
        [shiftId]: [incident, ...(prev[shiftId] ?? [])],
      }))
      showToast("success", "Incidencia registrada.")
    } catch (error: unknown) {
      showToast("error", extractErrorMessage(error, "No se pudo registrar la incidencia."))
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

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <Card title="Turnos" subtitle="Operacion de empleado y supervision en un mismo modulo." />

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

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Ubicacion GPS" subtitle="Debes tener coordenadas validas para ejecutar acciones.">
                <div className="mt-3">
                  <GPSGuard onLocation={setCoords} />
                </div>
              </Card>

              <Card title="Evidencia fotografica" subtitle="La foto se toma desde camara y se sube a Storage.">
                <div className="mt-3">
                  <CameraCapture onCapture={setPhoto} />
                </div>
              </Card>
            </div>

            <Card
              title="Accion principal"
              subtitle={activeShift ? "Finalizar turno activo" : "Iniciar nuevo turno"}
            >
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

            <Card title="Turnos programados" subtitle="Agenda asignada para tus proximas jornadas.">
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
            <h2 className="text-lg font-semibold text-slate-900">Panel de supervisora</h2>

            {loadingSupervisor ? (
              <Skeleton className="h-40" />
            ) : supervisorRows.length === 0 ? (
              <EmptyState
                title="Sin turnos activos"
                description="Cuando haya actividad en curso la veras aqui."
                actionLabel="Actualizar"
                onAction={() => void loadSupervisorData()}
              />
            ) : (
              <div className="space-y-3">
                {supervisorRows.map(row => {
                  const startEvidenceUrl = resolveEvidenceUrl(row.start_evidence_path)
                  const endEvidenceUrl = resolveEvidenceUrl(row.end_evidence_path)
                  return (
                    <Card
                      key={row.id}
                      title={`Turno ${String(row.id).slice(0, 8)}`}
                      subtitle={`Inicio: ${formatDateTime(row.start_time)} | Estado: ${row.status}`}
                    >
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 p-3 text-sm">
                          <p className="font-medium text-slate-700">Evidencia inicio</p>
                          {startEvidenceUrl ? (
                            <a
                              className="text-blue-700 underline"
                              href={startEvidenceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Ver evidencia inicial
                            </a>
                          ) : (
                            <p className="text-slate-500">Sin evidencia registrada.</p>
                          )}
                        </div>
                        <div className="rounded-lg border border-slate-200 p-3 text-sm">
                          <p className="font-medium text-slate-700">Evidencia cierre</p>
                          {endEvidenceUrl ? (
                            <a
                              className="text-blue-700 underline"
                              href={endEvidenceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Ver evidencia final
                            </a>
                          ) : (
                            <p className="text-slate-500">Pendiente de cierre.</p>
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

                      <div className="mt-4 space-y-2">
                        <label className="text-sm font-medium text-slate-700">Registrar incidencia</label>
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
                          Guardar incidencia
                        </Button>
                      </div>

                      {(incidentHistory[row.id] ?? []).length > 0 && (
                        <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
                          <p className="mb-2 font-medium text-slate-700">Incidencias recientes</p>
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


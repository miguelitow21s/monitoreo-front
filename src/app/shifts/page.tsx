"use client"

import { useEffect, useMemo, useState } from "react"

import CameraCapture from "@/components/CameraCapture"
import GPSGuard, { Coordinates } from "@/components/GPSGuard"
import ProtectedRoute from "@/components/ProtectedRoute"
import Badge from "@/components/ui/Badge"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import {
  endShift,
  getMyActiveShift,
  getMyShiftHistory,
  ShiftRecord,
  startShift,
} from "@/services/shifts.service"
import { supabase } from "@/services/supabaseClient"

const HISTORY_PAGE_SIZE = 8

type Feedback = {
  type: "success" | "error"
  text: string
} | null

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
  const [coords, setCoords] = useState<Coordinates | null>(null)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [activeShift, setActiveShift] = useState<ShiftRecord | null>(null)
  const [history, setHistory] = useState<ShiftRecord[]>([])
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotalPages, setHistoryTotalPages] = useState(1)

  const canSubmit = !!coords && !!photo && !processing

  const submitBlockers = useMemo(() => {
    const blockers: string[] = []
    if (!coords) blockers.push("Debes capturar ubicacion GPS.")
    if (!photo) blockers.push("Debes capturar evidencia fotografica.")
    if (processing) blockers.push("Hay una accion en proceso.")
    return blockers
  }, [coords, photo, processing])

  useEffect(() => {
    void loadData(historyPage)
  }, [historyPage])

  const loadData = async (page: number) => {
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
      setFeedback({
        type: "error",
        text: extractErrorMessage(error, "No se pudo cargar la informacion de turnos."),
      })
    } finally {
      setLoadingData(false)
    }
  }

  const uploadEvidence = async (prefix: "shift-start" | "shift-end") => {
    if (!photo) throw new Error("Debe capturar evidencia fotografica.")

    const fileName = `${prefix}-${Date.now()}.jpg`
    const filePath = `users/${fileName}`

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
    setFeedback(null)

    try {
      const latestActive = await getMyActiveShift()
      if (latestActive) {
        setActiveShift(latestActive)
        throw new Error("Ya existe un turno activo. Debes finalizarlo antes de iniciar otro.")
      }

      const evidencePath = await uploadEvidence("shift-start")
      await startShift({ lat: coords.lat, lng: coords.lng, evidencePath })

      setFeedback({ type: "success", text: "Turno iniciado correctamente." })
      resetEvidenceAndLocation()
      setHistoryPage(1)
      await loadData(1)
    } catch (error: unknown) {
      setFeedback({
        type: "error",
        text: extractErrorMessage(error, "No fue posible iniciar el turno."),
      })
    } finally {
      setProcessing(false)
    }
  }

  const handleEnd = async () => {
    if (!canSubmit || !coords) return
    if (!activeShift) {
      setFeedback({ type: "error", text: "No hay un turno activo para finalizar." })
      return
    }

    setProcessing(true)
    setFeedback(null)

    try {
      const evidencePath = await uploadEvidence("shift-end")
      await endShift({
        shiftId: activeShift.id,
        lat: coords.lat,
        lng: coords.lng,
        evidencePath,
      })

      setFeedback({ type: "success", text: "Turno finalizado correctamente." })
      resetEvidenceAndLocation()
      setHistoryPage(1)
      await loadData(1)
    } catch (error: unknown) {
      setFeedback({
        type: "error",
        text: extractErrorMessage(error, "No fue posible finalizar el turno."),
      })
    } finally {
      setProcessing(false)
    }
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <Card
          title="Turnos"
          subtitle="Inicia y finaliza turnos con geolocalizacion obligatoria y evidencia fotografica."
        />

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

        <Card title="Accion principal" subtitle={activeShift ? "Finalizar turno activo" : "Iniciar nuevo turno"}>
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

        {feedback && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              feedback.type === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-red-300 bg-red-50 text-red-700"
            }`}
          >
            {feedback.text}
          </div>
        )}

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
              onAction={() => void loadData(historyPage)}
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
      </div>
    </ProtectedRoute>
  )
}

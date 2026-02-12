"use client"

import { useEffect, useState } from "react"

import ProtectedRoute from "@/components/ProtectedRoute"
import GPSGuard from "@/components/GPSGuard"
import CameraCapture from "@/components/CameraCapture"
import { endShift, getMyActiveShift, getMyShiftHistory, startShift } from "@/services/shifts.service"
import { supabase } from "@/services/supabaseClient"

interface Coordinates {
  lat: number
  lng: number
}

interface Shift {
  id: string
  start_time: string
  end_time: string | null
  status: string
}

export default function ShiftsPage() {
  const [coords, setCoords] = useState<Coordinates | null>(null)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [activeShift, setActiveShift] = useState<Shift | null>(null)
  const [history, setHistory] = useState<Shift[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [captureKey, setCaptureKey] = useState(0)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const active = await getMyActiveShift()
      setActiveShift(active ?? null)
      const hist = await getMyShiftHistory()
      setHistory(hist ?? [])
    } catch {
      setMessage("No se pudo cargar la informacion de turnos.")
    }
  }

  const uploadEvidence = async (prefix: string) => {
    if (!photo) throw new Error("Sin evidencia")
    const path = `${prefix}-${Date.now()}.jpg`
    const { error } = await supabase.storage.from("evidence").upload(path, photo, { upsert: false })
    if (error) throw error
    return path
  }

  const handleStart = async () => {
    if (!coords || !photo) return
    setLoading(true)
    setMessage(null)
    try {
      const evidencePath = await uploadEvidence("shift-start")
      await startShift({ lat: coords.lat, lng: coords.lng, evidencePath })
      setMessage("Turno iniciado correctamente.")
      setPhoto(null)
      setCoords(null)
      setCaptureKey(k => k + 1)
      await loadData()
    } catch {
      setMessage("No fue posible iniciar el turno.")
    } finally {
      setLoading(false)
    }
  }

  const handleEnd = async () => {
    if (!coords || !photo || !activeShift) return
    setLoading(true)
    setMessage(null)
    try {
      const evidencePath = await uploadEvidence("shift-end")
      await endShift({ shiftId: activeShift.id, lat: coords.lat, lng: coords.lng, evidencePath })
      setMessage("Turno finalizado correctamente.")
      setPhoto(null)
      setCoords(null)
      setActiveShift(null)
      setCaptureKey(k => k + 1)
      await loadData()
    } catch {
      setMessage("No fue posible finalizar el turno.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Turnos</h1>
          <p className="mt-2 text-sm text-slate-600">
            Registra inicio y cierre con validacion de ubicacion y evidencia.
          </p>
        </div>

        {activeShift && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
            Turno activo desde <b>{activeShift.start_time}</b>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-base font-semibold text-slate-900">Ubicacion</h2>
            <GPSGuard onLocation={setCoords} />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-base font-semibold text-slate-900">Evidencia fotografica</h2>
            <CameraCapture key={captureKey} onCapture={setPhoto} />
          </div>
        </div>

        <div>
          {!activeShift ? (
            <button
              onClick={handleStart}
              disabled={!coords || !photo || loading}
              className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Procesando..." : "Iniciar turno"}
            </button>
          ) : (
            <button
              onClick={handleEnd}
              disabled={!coords || !photo || loading}
              className="rounded-lg bg-red-600 px-6 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Procesando..." : "Finalizar turno"}
            </button>
          )}
        </div>

        {message && <div className="text-sm text-slate-700">{message}</div>}

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Historial</h2>
          {history.length === 0 && <div className="text-sm text-slate-500">No hay turnos registrados.</div>}
          <div className="space-y-2">
            {history.map(shift => (
              <div key={shift.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div>Inicio: {shift.start_time}</div>
                <div>Fin: {shift.end_time ?? "Activo"}</div>
                <div>Estado: {shift.status}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}

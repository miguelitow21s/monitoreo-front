"use client"

import { useEffect, useState } from "react"
import ProtectedRoute from "@/components/ProtectedRoute"
import GPSGuard from "@/components/GPSGuard"
import CameraCapture from "@/components/CameraCapture"
import {
  startShift,
  endShift,
  getMyActiveShift,
  getMyShiftHistory,
} from "@/services/shifts.service"
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
      // errores silenciosos controlados por backend
    }
  }

  const uploadEvidence = async (prefix: string) => {
    if (!photo) throw new Error("Sin evidencia")

    const path = `${prefix}-${Date.now()}.jpg`

    const { error } = await supabase.storage
      .from("evidence")
      .upload(path, photo, { upsert: false })

    if (error) throw error
    return path
  }

  const handleStart = async () => {
    if (!coords || !photo) return

    setLoading(true)
    setMessage(null)

    try {
      const evidencePath = await uploadEvidence("shift-start")

      await startShift({
        lat: coords.lat,
        lng: coords.lng,
        evidencePath,
      })

      setMessage("Turno iniciado correctamente")

      // 🔐 Reset antifraude
      setPhoto(null)
      setCoords(null)
      setCaptureKey(k => k + 1)

      await loadData()
    } catch {
      setMessage("No fue posible iniciar el turno")
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

      await endShift({
        shiftId: activeShift.id,
        lat: coords.lat,
        lng: coords.lng,
        evidencePath,
      })

      setMessage("Turno finalizado correctamente")

      // 🔐 Reset antifraude
      setPhoto(null)
      setCoords(null)
      setActiveShift(null)
      setCaptureKey(k => k + 1)

      await loadData()
    } catch {
      setMessage("No fue posible finalizar el turno")
    } finally {
      setLoading(false)
    }
  }

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">Turnos</h1>

        {/* Estado del turno */}
        {activeShift && (
          <div className="rounded border border-green-500 bg-green-50 p-3 text-sm">
            Turno activo desde <b>{activeShift.start_time}</b>
          </div>
        )}

        {/* GPS */}
        <div className="rounded border p-4">
          <h2 className="font-semibold mb-2">Ubicación</h2>
          <GPSGuard onLocation={setCoords} />
        </div>

        {/* Cámara */}
        <div className="rounded border p-4">
          <h2 className="font-semibold mb-2">Evidencia fotográfica</h2>
          <CameraCapture key={captureKey} onCapture={setPhoto} />
        </div>

        {/* Acción principal */}
        {!activeShift ? (
          <button
            onClick={handleStart}
            disabled={!coords || !photo || loading}
            className="rounded bg-green-600 px-6 py-2 text-white disabled:opacity-50"
          >
            {loading ? "Procesando…" : "Iniciar turno"}
          </button>
        ) : (
          <button
            onClick={handleEnd}
            disabled={!coords || !photo || loading}
            className="rounded bg-red-600 px-6 py-2 text-white disabled:opacity-50"
          >
            {loading ? "Procesando…" : "Finalizar turno"}
          </button>
        )}

        {/* Mensajes */}
        {message && (
          <div className="text-sm text-gray-700">
            {message}
          </div>
        )}

        {/* Historial */}
        <div className="pt-6">
          <h2 className="font-semibold mb-2">Historial</h2>

          {history.length === 0 && (
            <div className="text-sm text-gray-500">
              No hay turnos registrados
            </div>
          )}

          <div className="space-y-2">
            {history.map(shift => (
              <div
                key={shift.id}
                className="rounded border p-3 text-sm"
              >
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
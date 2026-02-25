"use client"

import { useCallback, useEffect, useState } from "react"

import Button from "@/components/ui/Button"
import { useI18n } from "@/hooks/useI18n"

export interface Coordinates {
  lat: number
  lng: number
}

type GpsState = "idle" | "loading" | "ready" | "error"

interface GPSGuardProps {
  onLocation: (coords: Coordinates | null) => void
}

export default function GPSGuard({ onLocation }: GPSGuardProps) {
  const { t } = useI18n()
  const [state, setState] = useState<GpsState>("idle")
  const [coords, setCoords] = useState<Coordinates | null>(null)
  const [error, setError] = useState<string | null>(null)

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setState("error")
      setError(t("Este dispositivo no soporta geolocalizacion.", "This device does not support geolocation."))
      setCoords(null)
      onLocation(null)
      return
    }

    setState("loading")
    setError(null)

    navigator.geolocation.getCurrentPosition(
      position => {
        const nextCoords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }

        setCoords(nextCoords)
        setState("ready")
        onLocation(nextCoords)
      },
      geolocationError => {
        let message = t("No se pudo obtener la ubicacion.", "Could not get location.")
        if (geolocationError.code === geolocationError.PERMISSION_DENIED) {
          message = t("Permiso de ubicacion denegado.", "Location permission denied.")
        } else if (geolocationError.code === geolocationError.POSITION_UNAVAILABLE) {
          message = t("Ubicacion no disponible.", "Location unavailable.")
        } else if (geolocationError.code === geolocationError.TIMEOUT) {
          message = t("Tiempo agotado al solicitar GPS.", "GPS request timed out.")
        }

        setError(message)
        setState("error")
        setCoords(null)
        onLocation(null)
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    )
  }, [onLocation])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      requestLocation()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [requestLocation])

  return (
    <div className="space-y-3">
      {state === "loading" && <p className="text-sm text-slate-500">{t("Obteniendo ubicacion GPS...", "Getting GPS location...")}</p>}

      {state === "ready" && coords && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {t("GPS activo.", "GPS ready.")} Lat: {coords.lat.toFixed(6)} | Lng: {coords.lng.toFixed(6)}
        </div>
      )}

      {state === "error" && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <Button variant="secondary" size="sm" onClick={requestLocation}>
        {t("Reintentar GPS", "Retry GPS")}
      </Button>
    </div>
  )
}

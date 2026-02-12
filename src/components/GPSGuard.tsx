"use client"

import { useEffect, useState } from "react"

interface Coordinates {
  lat: number
  lng: number
}

interface GPSGuardProps {
  onLocation: (coords: Coordinates) => void
}

export default function GPSGuard({ onLocation }: GPSGuardProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("El dispositivo no soporta GPS")
      setLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }
        onLocation(coords)
        setLoading(false)
      },
      err => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError("Permiso de ubicacion denegado")
            break
          case err.POSITION_UNAVAILABLE:
            setError("Ubicacion no disponible")
            break
          case err.TIMEOUT:
            setError("Tiempo de espera agotado")
            break
          default:
            setError("Error obteniendo ubicacion")
        }
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }, [onLocation])

  if (loading) return <div className="text-sm text-slate-500">Obteniendo ubicacion...</div>
  if (error) return <div className="text-sm text-red-600">{error}</div>
  return <div className="text-sm text-emerald-600">Ubicacion capturada</div>
}

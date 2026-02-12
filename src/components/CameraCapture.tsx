"use client"

import { useEffect, useRef, useState } from "react"

import Button from "@/components/ui/Button"

interface CameraCaptureProps {
  onCapture: (image: Blob | null) => void
}

export default function CameraCapture({ onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [captured, setCaptured] = useState(false)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }

  const resetCapture = () => {
    setCaptured(false)
    setReady(false)
    setError(null)
    onCapture(null)
  }

  useEffect(() => {
    return () => stopCamera()
  }, [])

  const startCamera = async () => {
    setError(null)

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("El dispositivo no soporta camara en este navegador.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setReady(true)
      }
    } catch (err: unknown) {
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          setError("Permiso de camara denegado.")
        } else if (err.name === "NotFoundError") {
          setError("No se encontro una camara disponible.")
        } else if (err.name === "NotReadableError") {
          setError("No fue posible acceder al dispositivo de camara.")
        } else {
          setError("Error al activar la camara.")
        }
      } else {
        setError("Error al activar la camara.")
      }
    }
  }

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current || captured) return

    const canvas = canvasRef.current
    const video = videoRef.current

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext("2d")
    if (!ctx) {
      setError("No se pudo capturar la evidencia.")
      return
    }

    ctx.drawImage(video, 0, 0)

    canvas.toBlob(
      blob => {
        if (!blob) {
          setError("No se pudo generar la evidencia.")
          return
        }

        onCapture(blob)
        setCaptured(true)
        stopCamera()
      },
      "image/jpeg",
      0.9
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {!ready && !captured && (
        <Button onClick={startCamera} size="sm">
          Activar camara
        </Button>
      )}

      {!captured && (
        <video
          ref={videoRef}
          className="w-full max-w-sm rounded-lg border border-slate-300 bg-slate-900"
          playsInline
          muted
        />
      )}

      <canvas ref={canvasRef} className="hidden" />

      {ready && !captured && (
        <Button variant="secondary" size="sm" onClick={capturePhoto}>
          Capturar evidencia
        </Button>
      )}

      {captured && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Evidencia fotografica capturada.
        </div>
      )}

      {captured && (
        <Button variant="ghost" size="sm" onClick={resetCapture}>
          Tomar nueva foto
        </Button>
      )}
    </div>
  )
}

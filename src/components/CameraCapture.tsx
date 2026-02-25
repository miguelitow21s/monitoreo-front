"use client"

import { useEffect, useRef, useState } from "react"

import Button from "@/components/ui/Button"

interface CameraCaptureProps {
  onCapture: (image: Blob | null) => void
  overlayLines?: string[]
}

function drawEvidenceOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, lines: string[]) {
  const nowLine = `Capturada: ${new Date().toLocaleString("es-CO")}`
  const mergedLines = [nowLine, ...lines.filter(item => item.trim().length > 0)]
  const paddingX = 12
  const paddingY = 10
  const lineHeight = 16
  const boxHeight = paddingY * 2 + mergedLines.length * lineHeight

  ctx.save()
  ctx.fillStyle = "rgba(15, 23, 42, 0.72)"
  ctx.fillRect(0, height - boxHeight, width, boxHeight)

  ctx.font = "600 12px Arial, sans-serif"
  ctx.fillStyle = "#ffffff"
  mergedLines.forEach((line, index) => {
    ctx.fillText(line, paddingX, height - boxHeight + paddingY + (index + 0.8) * lineHeight)
  })
  ctx.restore()
}

export default function CameraCapture({ onCapture, overlayLines = [] }: CameraCaptureProps) {
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
      setError("Este dispositivo no permite acceso a camara en este navegador.")
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
          setError("No se encontro camara disponible.")
        } else if (err.name === "NotReadableError") {
          setError("No se pudo acceder al dispositivo de camara.")
        } else {
          setError("Error al habilitar la camara.")
        }
      } else {
        setError("Error al habilitar la camara.")
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
      setError("No se pudo capturar la foto de evidencia.")
      return
    }

    ctx.drawImage(video, 0, 0)
    drawEvidenceOverlay(ctx, canvas.width, canvas.height, overlayLines)

    canvas.toBlob(
      blob => {
        if (!blob) {
          setError("No se pudo generar el archivo de evidencia.")
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
          Habilitar camara
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
          Foto de evidencia capturada.
        </div>
      )}

      {captured && (
        <Button variant="ghost" size="sm" onClick={resetCapture}>
          Tomar otra foto
        </Button>
      )}
    </div>
  )
}

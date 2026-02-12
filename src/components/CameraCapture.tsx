"use client"

import { useEffect, useRef, useState } from "react"

interface CameraCaptureProps {
  onCapture: (image: Blob) => void
}

export default function CameraCapture({ onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [captured, setCaptured] = useState(false)

  // 🔧 DECLARAR PRIMERO
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [])

  const startCamera = async () => {
    setError(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
      })

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setReady(true)
      }
    } catch (err: unknown) {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
        setError("Permiso de cámara denegado")
        break
      case "NotFoundError":
        setError("No se encontró cámara disponible")
        break
      default:
        setError("Error al acceder a la cámara")
    }
  } else {
    setError("Error al acceder a la cámara")
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
    if (!ctx) return

    ctx.drawImage(video, 0, 0)

    canvas.toBlob(blob => {
      if (blob) {
        onCapture(blob)
        setCaptured(true)
        stopCamera()
      }
    }, "image/jpeg", 0.9)
  }

  if (captured) {
    return (
      <div className="text-sm text-green-600">
        Evidencia fotográfica capturada
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {error && <div className="text-sm text-red-600">{error}</div>}

      {!ready && (
        <button
          onClick={startCamera}
          className="rounded bg-blue-600 px-4 py-2 text-white"
        >
          Activar cámara
        </button>
      )}

      <video
        ref={videoRef}
        className="w-full max-w-xs rounded border"
        playsInline
        muted
      />

      <canvas ref={canvasRef} className="hidden" />

      {ready && !captured && (
        <button
          onClick={capturePhoto}
          className="rounded bg-green-600 px-4 py-2 text-white"
        >
          Capturar evidencia
        </button>
      )}
    </div>
  )
}
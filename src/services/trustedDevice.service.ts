import { invokeEdge } from "@/services/edgeClient"
import { getOrCreateDeviceFingerprint } from "@/services/securityContext.service"

interface TrustedDeviceValidateResponse {
  trusted?: boolean
  registration_required?: boolean
}

let trustedDeviceReadyInSession = false

type InvokeErrorShape = Error & {
  status?: number
  request_id?: string
  code?: string
}

function resolveDeviceName() {
  if (typeof window === "undefined") return "Web client"
  const platform = window.navigator.platform?.trim() || "web"
  return `Web on ${platform}`
}

function normalizeTrustedDeviceRegisterError(error: unknown): never {
  const candidate = (error ?? {}) as InvokeErrorShape
  const status = typeof candidate.status === "number" ? candidate.status : null
  const requestId = typeof candidate.request_id === "string" ? candidate.request_id : null
  const message = typeof candidate.message === "string" ? candidate.message : "No se pudo registrar el dispositivo confiable."
  const normalizedMessage = message.toLowerCase()

  if (
    status === 409 ||
    normalizedMessage.includes("limite de dispositivos") ||
    normalizedMessage.includes("trusted devices")
  ) {
    const explanation = [
      "Limite de dispositivos confiables alcanzado.",
      "Usa un dispositivo ya autorizado o solicita al backend liberar/revocar uno existente.",
    ].join(" ")
    const withRequestId = requestId ? `${explanation} (request_id: ${requestId})` : explanation
    const decorated = new Error(withRequestId) as InvokeErrorShape
    decorated.status = 409
    decorated.code = "TRUSTED_DEVICE_LIMIT"
    if (requestId) decorated.request_id = requestId
    throw decorated
  }

  if (error instanceof Error) {
    throw error
  }

  throw new Error(message)
}

export async function ensureTrustedDeviceReady() {
  if (trustedDeviceReadyInSession) {
    return { fingerprint: getOrCreateDeviceFingerprint() }
  }

  const fingerprint = getOrCreateDeviceFingerprint()

  const validation = await invokeEdge<TrustedDeviceValidateResponse>("trusted_device_validate", {
    idempotencyKey: crypto.randomUUID(),
    extraHeaders: {
      "x-device-fingerprint": fingerprint,
    },
    body: {
      device_fingerprint: fingerprint,
    },
  })

  const requiresRegistration = validation?.registration_required === true || validation?.trusted === false

  if (requiresRegistration) {
    try {
      await invokeEdge("trusted_device_register", {
        idempotencyKey: crypto.randomUUID(),
        extraHeaders: {
          "x-device-fingerprint": fingerprint,
        },
        body: {
          device_fingerprint: fingerprint,
          device_name: resolveDeviceName(),
          platform: "web",
        },
      })
    } catch (error: unknown) {
      normalizeTrustedDeviceRegisterError(error)
    }
  }

  trustedDeviceReadyInSession = true
  return { fingerprint }
}

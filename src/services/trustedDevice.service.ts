import { invokeEdge } from "@/services/edgeClient"
import { getOrCreateDeviceFingerprint } from "@/services/securityContext.service"

interface TrustedDeviceValidateResponse {
  trusted?: boolean
  registration_required?: boolean
}

let trustedDeviceReadyInSession = false

function resolveDeviceName() {
  if (typeof window === "undefined") return "Web client"
  const platform = window.navigator.platform?.trim() || "web"
  return `Web on ${platform}`
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
  }

  trustedDeviceReadyInSession = true
  return { fingerprint }
}

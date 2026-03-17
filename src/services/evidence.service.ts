import { invokeEdge } from "@/services/edgeClient"
import { getShiftOtpToken } from "@/services/securityContext.service"
import { supabase } from "@/services/supabaseClient"
import { ensureTrustedDeviceReady } from "@/services/trustedDevice.service"

type EvidenceType = "inicio" | "fin"

export type EvidenceMeta = {
  area_key: string
  area_label: string
  subarea_key?: string
  subarea_label?: string
  area_detail?: string
}

interface RequestUploadResponse {
  upload?: {
    token?: string
    path?: string
    signedUrl?: string
  }
  bucket?: string
  upload_url?: string
  signed_url?: string
  url?: string
  path?: string
  headers?: Record<string, string>
}

interface FinalizePayload {
  shiftId: number
  type: EvidenceType
  path: string
  lat: number
  lng: number
  accuracy?: number
  capturedAt: string
  meta?: EvidenceMeta
}

function resolveUploadUrl(payload: RequestUploadResponse) {
  return payload.upload?.signedUrl ?? payload.upload_url ?? payload.signed_url ?? payload.url ?? null
}

function resolveUploadPath(payload: RequestUploadResponse) {
  return payload.upload?.path ?? payload.path ?? null
}

function resolveUploadToken(payload: RequestUploadResponse) {
  return payload.upload?.token ?? null
}

function resolveUploadBucket(payload: RequestUploadResponse) {
  return payload.bucket ?? null
}

async function requestUpload(shiftId: number, type: EvidenceType) {
  const otpToken = getShiftOtpToken()
  if (!otpToken) {
    throw new Error("OTP token is required. Verify OTP before uploading shift evidence.")
  }
  const { fingerprint } = await ensureTrustedDeviceReady()

  return invokeEdge<RequestUploadResponse>("evidence_upload", {
    idempotencyKey: crypto.randomUUID(),
    extraHeaders: {
      "x-device-fingerprint": fingerprint,
      "x-shift-otp-token": otpToken,
    },
    body: {
      action: "request_upload",
      shift_id: shiftId,
      type,
    },
  })
}

async function finalizeUpload(payload: FinalizePayload) {
  const otpToken = getShiftOtpToken()
  if (!otpToken) {
    throw new Error("OTP token is required. Verify OTP before finalizing shift evidence.")
  }
  const { fingerprint } = await ensureTrustedDeviceReady()

  return invokeEdge("evidence_upload", {
    idempotencyKey: crypto.randomUUID(),
    extraHeaders: {
      "x-device-fingerprint": fingerprint,
      "x-shift-otp-token": otpToken,
    },
    body: {
      action: "finalize_upload",
      shift_id: payload.shiftId,
      type: payload.type,
      path: payload.path,
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy ?? 8,
      captured_at: payload.capturedAt,
      ...(payload.meta ? { meta: payload.meta } : {}),
    },
  })
}

export async function uploadShiftEvidence(payload: {
  shiftId: number
  type: EvidenceType
  file: Blob
  lat: number
  lng: number
  accuracy?: number
  capturedAt?: string
  meta?: EvidenceMeta
}) {
  const requested = await requestUpload(payload.shiftId, payload.type)
  const uploadUrl = resolveUploadUrl(requested)
  const uploadPath = resolveUploadPath(requested)
  const uploadToken = resolveUploadToken(requested)
  const uploadBucket = resolveUploadBucket(requested)

  if (!uploadPath) {
    throw new Error("Invalid upload payload from backend (missing upload path).")
  }

  if (uploadBucket && uploadToken) {
    const { error } = await supabase.storage.from(uploadBucket).uploadToSignedUrl(uploadPath, uploadToken, payload.file)
    if (error) {
      throw new Error(`Could not upload evidence binary via signed token: ${error.message}`)
    }
  } else {
    if (!uploadUrl) {
      throw new Error("Invalid upload payload from backend (missing upload URL).")
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": payload.file.type || "application/octet-stream",
        ...(requested.headers ?? {}),
      },
      body: payload.file,
    })

    if (!uploadResponse.ok) {
      throw new Error(`Could not upload evidence binary (HTTP ${uploadResponse.status}).`)
    }
  }

  await finalizeUpload({
    shiftId: payload.shiftId,
    type: payload.type,
    path: uploadPath,
    lat: payload.lat,
    lng: payload.lng,
    accuracy: payload.accuracy,
    capturedAt: payload.capturedAt ?? new Date().toISOString(),
    meta: payload.meta,
  })

  return uploadPath
}

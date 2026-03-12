import { invokeEdge } from "@/services/edgeClient"
import { supabase } from "@/services/supabaseClient"
import { createEvidenceSignedUrl, uploadEvidenceObject } from "@/services/storageEvidence.service"

type EvidenceType = "inicio" | "fin"

interface RequestUploadResponse {
  upload?: {
    token?: string
    path?: string
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
}

function resolveUploadUrl(payload: RequestUploadResponse) {
  return payload.upload_url ?? payload.signed_url ?? payload.url ?? null
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
  return invokeEdge<RequestUploadResponse>("evidence_upload", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "request_upload",
      shift_id: shiftId,
      type,
    },
  })
}

async function finalizeUpload(payload: FinalizePayload) {
  return invokeEdge("evidence_upload", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "finalize_upload",
      shift_id: payload.shiftId,
      type: payload.type,
      path: payload.path,
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy ?? 8,
      captured_at: payload.capturedAt,
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
}) {
  try {
    const requested = await requestUpload(payload.shiftId, payload.type)
    const uploadUrl = resolveUploadUrl(requested)
    const uploadPath = resolveUploadPath(requested)
    const uploadToken = resolveUploadToken(requested)
    const uploadBucket = resolveUploadBucket(requested)

    if (!uploadPath) {
      throw new Error("Invalid upload payload from backend (missing upload path).")
    }

    if (uploadBucket && uploadToken) {
      const { error } = await supabase.storage
        .from(uploadBucket)
        .uploadToSignedUrl(uploadPath, uploadToken, payload.file)

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
    })

    return uploadPath
  } catch {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError) throw userError
    if (!user?.id) throw new Error("Authenticated user not found for evidence upload.")

    const extensionFromMime = payload.file.type.split("/")[1]?.toLowerCase() || "jpg"
    const timestamp = new Date().toISOString().replaceAll(":", "-")
    const filePath = `users/${user.id}/shift-evidence-direct/${payload.shiftId}/${payload.type}-${timestamp}.${extensionFromMime}`

    await uploadEvidenceObject(filePath, payload.file, {
      contentType: payload.file.type || "application/octet-stream",
      upsert: false,
    })

    const signedUrl = await createEvidenceSignedUrl(filePath, 1800)
    if (!signedUrl) {
      throw new Error("Could not resolve signed URL for direct evidence flow.")
    }

    await invokeEdge("evidence_upload", {
      idempotencyKey: crypto.randomUUID(),
      body: {
        shift_id: payload.shiftId,
        url: signedUrl,
        type: payload.type,
        lat: payload.lat,
        lng: payload.lng,
      },
    })

    return filePath
  }
}

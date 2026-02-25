import { invokeEdge } from "@/services/edgeClient"

type EvidenceType = "inicio" | "fin"

interface RequestUploadResponse {
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
  return payload.path ?? null
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
  const requested = await requestUpload(payload.shiftId, payload.type)
  const uploadUrl = resolveUploadUrl(requested)
  const uploadPath = resolveUploadPath(requested)

  if (!uploadUrl || !uploadPath) {
    throw new Error("Payload de carga invalido desde backend (falta upload URL/path).")
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
    throw new Error(`No se pudo subir el binario de evidencia (HTTP ${uploadResponse.status}).`)
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
}

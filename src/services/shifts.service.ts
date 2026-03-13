import { invokeEdge } from "@/services/edgeClient"
import {
  getShiftOtpToken,
  setShiftOtpToken,
} from "@/services/securityContext.service"
import { ensureTrustedDeviceReady } from "@/services/trustedDevice.service"
import { debugLog } from "@/services/debug"
import { supabase } from "@/services/supabaseClient"

export type ShiftStatus = "active" | "completed" | "cancelled" | string

export interface ShiftRecord {
  id: string
  start_time: string
  end_time: string | null
  status: ShiftStatus
}

interface StartShiftPayload {
  restaurantId?: number
  lat: number
  lng: number
  fitForWork: boolean
  declaration: string | null
}

interface EndShiftPayload {
  shiftId: string
  lat: number
  lng: number
  fitForWork: boolean
  declaration: string | null
  earlyEndReason?: string | null
}

function extractVerificationToken(payload: unknown) {
  if (!payload || typeof payload !== "object") return null
  const candidate = payload as {
    verification_token?: unknown
    token?: unknown
    otp_token?: unknown
    shift_otp_token?: unknown
  }

  const token =
    candidate.verification_token ?? candidate.token ?? candidate.otp_token ?? candidate.shift_otp_token

  return typeof token === "string" && token.trim().length > 0 ? token.trim() : null
}

function sanitizePhoneForLogs(value: unknown) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.includes("*")) return trimmed
  // Mask anything that looks like a full phone number.
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length >= 7) {
    const prefix = trimmed.slice(0, 2)
    const suffix = trimmed.slice(-2)
    return `${prefix}***${suffix}`
  }
  return "[redacted]"
}

function normalizeOtpPhone(value: unknown) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed
}

function isValidE164(value: string) {
  return /^\+\d{7,15}$/.test(value)
}

async function getOtpPhoneE164(options?: { allowMissing?: boolean }) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error) throw error
  const phone = normalizeOtpPhone(user?.phone)

  if (!phone || !isValidE164(phone)) {
    if (options?.allowMissing) return null
    throw new Error("Phone number for OTP is missing or invalid. Please set users.phone_e164 in E.164 format.")
  }

  return phone
}

export async function getOtpPhoneE164Status() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error) throw error
  const phone = normalizeOtpPhone(user?.phone)
  return { phoneE164: phone, isValid: !!phone && isValidE164(phone) }
}

function extractOtpSendMeta(payload: unknown) {
  if (!payload || typeof payload !== "object") return null
  const candidate = payload as {
    otp_id?: unknown
    expires_at?: unknown
    masked_phone?: unknown
    debug_code?: unknown
    debugCode?: unknown
    phone?: unknown
    delivery_status?: unknown
  }

  return {
    otpId: typeof candidate.otp_id === "number" ? candidate.otp_id : null,
    expiresAt: typeof candidate.expires_at === "string" ? candidate.expires_at : null,
    maskedPhone: sanitizePhoneForLogs(candidate.masked_phone ?? candidate.phone),
    deliveryStatus: typeof candidate.delivery_status === "string" ? candidate.delivery_status : null,
    debugCode: typeof candidate.debug_code === "string"
      ? candidate.debug_code
      : typeof candidate.debugCode === "string"
        ? candidate.debugCode
        : null,
  }
}

function toErrorSnapshot(error: unknown) {
  if (!error || typeof error !== "object") return { message: String(error ?? "") }
  const candidate = error as { message?: unknown; code?: unknown; status?: unknown; details?: unknown; hint?: unknown }
  return {
    message: typeof candidate.message === "string" ? candidate.message : null,
    code: typeof candidate.code === "string" ? candidate.code : null,
    status: typeof candidate.status === "number" ? candidate.status : null,
    details: typeof candidate.details === "string" ? candidate.details : null,
    hint: typeof candidate.hint === "string" ? candidate.hint : null,
  }
}

export async function sendShiftPhoneOtp() {
  const otpDebugEnabled = process.env.NEXT_PUBLIC_OTP_DEBUG === "true"
  const phone = await getOtpPhoneE164({ allowMissing: otpDebugEnabled })
  const phoneMissing = !phone
  const { fingerprint } = await ensureTrustedDeviceReady()
  debugLog("otp.send.request", { fingerprint: fingerprint ? "set" : null })

  try {
    const response = await invokeEdge<unknown>("phone_otp_send", {
      idempotencyKey: crypto.randomUUID(),
      extraHeaders: {
        "x-device-fingerprint": fingerprint,
      },
      body: { device_fingerprint: fingerprint },
    })
    const meta = extractOtpSendMeta(response)
    debugLog("otp.send.success", {
      fingerprint: fingerprint ? "set" : null,
      maskedPhone: meta?.maskedPhone ?? null,
      otpId: meta?.otpId ?? null,
      expiresAt: meta?.expiresAt ?? null,
      deliveryStatus: meta?.deliveryStatus ?? null,
    })
    return {
      raw: response,
      maskedPhone: meta?.maskedPhone ?? null,
      otpId: meta?.otpId ?? null,
      expiresAt: meta?.expiresAt ?? null,
      deliveryStatus: meta?.deliveryStatus ?? null,
      debugCode: meta?.debugCode ?? null,
      phoneMissing,
    }
  } catch (error: unknown) {
    debugLog("otp.send.error", { error: toErrorSnapshot(error) })
    throw error
  }
}

export async function verifyShiftPhoneOtp(payload: { code: string }) {
  const code = payload.code.trim()
  if (!code) throw new Error("OTP code is required.")

  const { fingerprint } = await ensureTrustedDeviceReady()
  debugLog("otp.verify.request", { codeLength: code.length, fingerprint: fingerprint ? "set" : null })

  try {
    const data = await invokeEdge<unknown>("phone_otp_verify", {
      idempotencyKey: crypto.randomUUID(),
      extraHeaders: {
        "x-device-fingerprint": fingerprint,
      },
      body: {
        code,
        device_fingerprint: fingerprint,
      },
    })

    const token = extractVerificationToken(data)
    if (!token) throw new Error("Phone verification succeeded but verification token was not returned.")

    setShiftOtpToken(token)
    debugLog("otp.verify.success", { token: "set" })
    return token
  } catch (error: unknown) {
    debugLog("otp.verify.error", { error: toErrorSnapshot(error) })
    throw error
  }
}

export interface ShiftHistoryResult {
  rows: ShiftRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

function normalizeActiveShift(data: unknown): ShiftRecord | null {
  if (!data) return null

  if (Array.isArray(data)) {
    return (data[0] as ShiftRecord | undefined) ?? null
  }

  return data as ShiftRecord
}

export async function startShift(payload: StartShiftPayload) {
  const { restaurantId, lat, lng, fitForWork, declaration } = payload
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || typeof fitForWork !== "boolean") {
    throw new Error("Incomplete data to start shift.")
  }

  const otpToken = getShiftOtpToken()
  if (!otpToken) {
    throw new Error("OTP token is required. Verify your phone before starting a shift.")
  }

  const { fingerprint } = await ensureTrustedDeviceReady()

  const data = await invokeEdge<unknown>("shifts_start", {
    idempotencyKey: crypto.randomUUID(),
    extraHeaders: {
      "x-device-fingerprint": fingerprint,
      "x-shift-otp-token": otpToken,
    },
    body: {
      restaurant_id: restaurantId,
      lat,
      lng,
      fit_for_work: fitForWork,
      declaration,
    },
  })

  if (typeof data === "number") return data
  if (typeof data === "object" && data !== null) {
    const shiftId = (data as { shift_id?: unknown; id?: unknown }).shift_id ?? (data as { id?: unknown }).id
    if (typeof shiftId === "number") return shiftId
    if (typeof shiftId === "string" && shiftId.trim()) return Number(shiftId)
  }
  throw new Error("Invalid response from shifts_start.")
}

export async function endShift(payload: EndShiftPayload) {
  const { shiftId, lat, lng, fitForWork, declaration, earlyEndReason } = payload
  if (!shiftId || !Number.isFinite(lat) || !Number.isFinite(lng) || typeof fitForWork !== "boolean") {
    throw new Error("Incomplete data to end shift.")
  }

  const otpToken = getShiftOtpToken()
  if (!otpToken) {
    throw new Error("OTP token is required. Verify your phone before ending a shift.")
  }

  const { fingerprint } = await ensureTrustedDeviceReady()

  return invokeEdge("shifts_end", {
    idempotencyKey: crypto.randomUUID(),
    extraHeaders: {
      "x-device-fingerprint": fingerprint,
      "x-shift-otp-token": otpToken,
    },
    body: {
      shift_id: Number(shiftId),
      lat,
      lng,
      fit_for_work: fitForWork,
      declaration,
      ...(earlyEndReason ? { early_end_reason: earlyEndReason } : {}),
    },
  })
}

export async function getMyActiveShift() {
  const { data, error } = await supabase.rpc("get_my_active_shift", {})
  if (error) throw error
  return normalizeActiveShift(data)
}

export async function getMyShiftHistory(page = 1, pageSize = 8): Promise<ShiftHistoryResult> {
  const safePage = Math.max(1, page)
  const safePageSize = Math.max(1, pageSize)
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user?.id) throw new Error("Authenticated user not found.")

  const { data, error, count } = await supabase
    .from("shifts")
    .select("id,start_time,end_time,status", { count: "exact" })
    .eq("employee_id", user.id)
    .order("start_time", { ascending: false })
    .range(from, to)

  if (error) throw error

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))

  return {
    rows: (data as ShiftRecord[]) ?? [],
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  }
}

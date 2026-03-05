"use client"

const DEVICE_FINGERPRINT_KEY = "app_device_fingerprint"
const SHIFT_OTP_TOKEN_KEY = "app_shift_otp_token"

function isBrowser() {
  return typeof window !== "undefined"
}

export function getOrCreateDeviceFingerprint() {
  if (!isBrowser()) return "server-context"

  const existing = window.localStorage.getItem(DEVICE_FINGERPRINT_KEY)
  if (existing && existing.trim().length > 0) return existing

  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`

  window.localStorage.setItem(DEVICE_FINGERPRINT_KEY, generated)
  return generated
}

export function getShiftOtpToken() {
  if (!isBrowser()) return null
  const token = window.sessionStorage.getItem(SHIFT_OTP_TOKEN_KEY)
  if (!token || token.trim().length === 0) return null
  return token.trim()
}

export function setShiftOtpToken(token: string) {
  if (!isBrowser()) return
  const normalized = token.trim()
  if (!normalized) {
    window.sessionStorage.removeItem(SHIFT_OTP_TOKEN_KEY)
    return
  }
  window.sessionStorage.setItem(SHIFT_OTP_TOKEN_KEY, normalized)
}

export function clearShiftOtpToken() {
  if (!isBrowser()) return
  window.sessionStorage.removeItem(SHIFT_OTP_TOKEN_KEY)
}

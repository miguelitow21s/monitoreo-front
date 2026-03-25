"use client"

const DEVICE_FINGERPRINT_KEY = "app_device_fingerprint"
const SHIFT_OTP_TOKEN_KEY = "app_shift_otp_token"

function isBrowser() {
  return typeof window !== "undefined"
}

function hashFingerprintSeed(seed: string, salt: number) {
  let hash = 2166136261 ^ salt
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function buildStableBrowserFingerprint() {
  if (!isBrowser()) return null
  try {
    const nav = window.navigator
    const screen = window.screen
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "unknown-timezone"
    const navWithDeviceMemory = nav as Navigator & { deviceMemory?: number }

    const seed = [
      nav.userAgent ?? "",
      nav.platform ?? "",
      nav.language ?? "",
      navWithDeviceMemory.deviceMemory ?? "",
      nav.hardwareConcurrency ?? "",
      nav.maxTouchPoints ?? "",
      screen?.width ?? "",
      screen?.height ?? "",
      screen?.colorDepth ?? "",
      window.devicePixelRatio ?? "",
      timeZone,
    ].join("|")

    const normalizedSeed = seed.replace(/\|/g, "").trim()
    if (!normalizedSeed) return null

    const salts = [0x9e3779b1, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f]
    const digest = salts.map(salt => hashFingerprintSeed(seed, salt)).join("")
    return `web-${digest}`
  } catch {
    return null
  }
}

export function getOrCreateDeviceFingerprint() {
  if (!isBrowser()) return "server-context"

  const existing = window.localStorage.getItem(DEVICE_FINGERPRINT_KEY)
  if (existing && existing.trim().length > 0) return existing

  const generated =
    buildStableBrowserFingerprint() ??
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`)

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

"use client"

const DEBUG_FLAG_KEY = "debug_api"
const DEBUG_ALL_KEY = "debug_api_all"

export function isDebugEnabled() {
  if (typeof window === "undefined") return false
  try {
    const value = window.localStorage.getItem(DEBUG_FLAG_KEY)
    return value === "1" || value === "true"
  } catch {
    return false
  }
}

export function isDebugAllEnabled() {
  if (typeof window === "undefined") return false
  try {
    const value = window.localStorage.getItem(DEBUG_ALL_KEY)
    return value === "1" || value === "true"
  } catch {
    return false
  }
}

export function debugGroup(label: string, payload: Record<string, unknown>) {
  if (!isDebugEnabled()) return
  console.groupCollapsed(`[debug] ${label}`)
  for (const [key, value] of Object.entries(payload)) {
    console.log(key, value)
  }
  console.groupEnd()
}

export function debugLog(label: string, payload?: unknown) {
  if (!isDebugEnabled()) return
  console.log(`[debug] ${label}`, payload ?? "")
}

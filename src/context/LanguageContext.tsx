"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { useRole } from "@/hooks/useRole"

export type AppLanguage = "es" | "en"

type LanguageContextValue = {
  language: AppLanguage
  isManual: boolean
  setLanguage: (next: AppLanguage) => void
  setLanguageAutoByRole: () => void
}

const STORAGE_LANGUAGE_KEY = "app_ui_language"
const STORAGE_MANUAL_KEY = "app_ui_language_manual"
const ROLE_LANGUAGE_MAP: Record<string, AppLanguage> = {
  super_admin: "es",
  supervisora: "es",
  empleado: "es",
  restaurant_owner: "en",
  restaurant_admin: "en",
  owner: "en",
  admin_restaurant: "en",
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined)

function isLanguage(value: string | null): value is AppLanguage {
  return value === "es" || value === "en"
}

function detectBrowserLanguage(): AppLanguage {
  if (typeof navigator === "undefined") return "es"
  const browserLanguage = (navigator.language || "es").toLowerCase()
  return browserLanguage.startsWith("es") ? "es" : "en"
}

function resolveLanguageByRole(role: string | null | undefined): AppLanguage {
  const normalizedRole = (role ?? "").trim().toLowerCase()
  if (normalizedRole && ROLE_LANGUAGE_MAP[normalizedRole]) {
    return ROLE_LANGUAGE_MAP[normalizedRole]
  }
  return detectBrowserLanguage()
}

function readStoredLanguageConfig() {
  if (typeof window === "undefined") {
    return { language: "es" as AppLanguage, isManual: false }
  }

  const savedLanguage = window.localStorage.getItem(STORAGE_LANGUAGE_KEY)
  const savedManual = window.localStorage.getItem(STORAGE_MANUAL_KEY) === "1"
  if (isLanguage(savedLanguage)) {
    return { language: savedLanguage, isManual: savedManual }
  }

  return { language: detectBrowserLanguage(), isManual: false }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { role } = useRole()
  // Keep first paint deterministic to avoid server/client text mismatch during hydration.
  const [manualLanguage, setManualLanguage] = useState<AppLanguage>("es")
  const [isManual, setIsManual] = useState(false)
  const roleLanguage = resolveLanguageByRole(typeof role === "string" ? role : null)
  const language = isManual ? manualLanguage : roleLanguage

  useEffect(() => {
    const stored = readStoredLanguageConfig()
    queueMicrotask(() => {
      setManualLanguage(stored.language)
      setIsManual(stored.isManual)
    })
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    const effectiveLanguage = isManual ? manualLanguage : roleLanguage
    window.localStorage.setItem(STORAGE_LANGUAGE_KEY, effectiveLanguage)
    window.localStorage.setItem(STORAGE_MANUAL_KEY, isManual ? "1" : "0")
  }, [isManual, manualLanguage, roleLanguage])

  const setLanguage = useCallback((next: AppLanguage) => {
    setManualLanguage(next)
    setIsManual(true)
  }, [])

  const setLanguageAutoByRole = useCallback(() => {
    setManualLanguage(resolveLanguageByRole(typeof role === "string" ? role : null))
    setIsManual(false)
  }, [role])

  const value = useMemo(
    () => ({
      language,
      isManual,
      setLanguage,
      setLanguageAutoByRole,
    }),
    [language, isManual, setLanguage, setLanguageAutoByRole]
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider.")
  }
  return context
}

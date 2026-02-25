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
const ENGLISH_ROLES = new Set(["restaurant_owner", "restaurant_admin", "owner", "admin_restaurant"])

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined)

function isLanguage(value: string | null): value is AppLanguage {
  return value === "es" || value === "en"
}

function resolveLanguageByRole(role: string | null | undefined): AppLanguage {
  if (!role) return "es"
  return ENGLISH_ROLES.has(role) ? "en" : "es"
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

  return { language: "es" as AppLanguage, isManual: false }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { role } = useRole()
  const [manualLanguage, setManualLanguage] = useState<AppLanguage>(() => readStoredLanguageConfig().language)
  const [isManual, setIsManual] = useState(() => readStoredLanguageConfig().isManual)
  const roleLanguage = resolveLanguageByRole(typeof role === "string" ? role : null)
  const language = isManual ? manualLanguage : roleLanguage

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
    throw new Error("useLanguage debe usarse dentro de LanguageProvider.")
  }
  return context
}

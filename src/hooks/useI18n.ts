"use client"

import { useCallback } from "react"

import { useLanguage } from "@/context/LanguageContext"

function normalizeDate(value: string | number | Date) {
  if (value instanceof Date) return value
  return new Date(value)
}

export function useI18n() {
  const { language } = useLanguage()
  const isEnglish = language === "en"
  const locale = isEnglish ? "en-US" : "es-CO"
  const t = useCallback((es: string, en: string) => (isEnglish ? en : es), [isEnglish])

  const formatDateTime = useCallback(
    (value: string | number | Date | null | undefined, options?: Intl.DateTimeFormatOptions) => {
      if (value === null || value === undefined) return "-"
      const date = normalizeDate(value)
      if (Number.isNaN(date.getTime())) return "-"
      return date.toLocaleString(locale, options)
    },
    [locale]
  )

  const formatDate = useCallback(
    (value: string | number | Date | null | undefined, options?: Intl.DateTimeFormatOptions) => {
      if (value === null || value === undefined) return "-"
      const date = normalizeDate(value)
      if (Number.isNaN(date.getTime())) return "-"
      return date.toLocaleDateString(locale, options)
    },
    [locale]
  )

  const formatTime = useCallback(
    (value: string | number | Date | null | undefined, options?: Intl.DateTimeFormatOptions) => {
      if (value === null || value === undefined) return "-"
      const date = normalizeDate(value)
      if (Number.isNaN(date.getTime())) return "-"
      return date.toLocaleTimeString(locale, options)
    },
    [locale]
  )

  return {
    language,
    isEnglish,
    locale,
    t,
    formatDateTime,
    formatDate,
    formatTime,
  }
}

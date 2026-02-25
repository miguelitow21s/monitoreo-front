"use client"

import { useLanguage } from "@/context/LanguageContext"

export function useI18n() {
  const { language } = useLanguage()
  const isEnglish = language === "en"
  const t = (es: string, en: string) => (isEnglish ? en : es)

  return {
    language,
    isEnglish,
    t,
  }
}

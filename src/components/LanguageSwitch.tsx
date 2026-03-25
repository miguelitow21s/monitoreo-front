"use client"

import { useLanguage } from "@/context/LanguageContext"

type LanguageSwitchProps = {
  compact?: boolean
  className?: string
}

export default function LanguageSwitch({ compact = false, className = "" }: LanguageSwitchProps) {
  const { language, setLanguage } = useLanguage()
  const wrapperSizeClass = compact ? "text-[11px]" : "text-xs"
  const buttonSizeClass = compact ? "px-2 py-0.5" : "px-2 py-1"

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className={`inline-flex items-center rounded-lg border border-slate-300 bg-white p-0.5 ${wrapperSizeClass}`}>
        <button
          type="button"
          onClick={() => setLanguage("es")}
          className={`rounded-md ${buttonSizeClass} font-semibold transition ${
            language === "es" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          ES
        </button>
        <button
          type="button"
          onClick={() => setLanguage("en")}
          className={`rounded-md ${buttonSizeClass} font-semibold transition ${
            language === "en" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          EN
        </button>
      </div>
    </div>
  )
}

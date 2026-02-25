"use client"

import { useLanguage } from "@/context/LanguageContext"

type LanguageSwitchProps = {
  compact?: boolean
  className?: string
}

export default function LanguageSwitch({ compact = false, className = "" }: LanguageSwitchProps) {
  const { language, isManual, setLanguage, setLanguageAutoByRole } = useLanguage()

  const label = language === "es" ? "Idioma" : "Language"
  const autoLabel = language === "es" ? "Auto por rol" : "Role auto"

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {!compact && <span className="text-xs text-slate-500">{label}</span>}
      <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setLanguage("es")}
          className={`rounded-md px-2 py-1 font-semibold transition ${
            language === "es" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          ES
        </button>
        <button
          type="button"
          onClick={() => setLanguage("en")}
          className={`rounded-md px-2 py-1 font-semibold transition ${
            language === "en" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          EN
        </button>
      </div>
      {isManual && (
        <button
          type="button"
          onClick={setLanguageAutoByRole}
          className="text-[11px] font-semibold text-slate-600 underline hover:text-slate-900"
        >
          {autoLabel}
        </button>
      )}
    </div>
  )
}

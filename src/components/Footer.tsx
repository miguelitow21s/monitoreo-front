"use client"

import { useLanguage } from "@/context/LanguageContext"

type FooterProps = {
  collapsed: boolean
}

export default function Footer({ collapsed }: FooterProps) {
  const leftClass = collapsed ? "md:left-20" : "md:left-64"
  const { language } = useLanguage()
  const t = (es: string, en: string) => (language === "en" ? en : es)

  return (
    <footer
      className={`fixed bottom-0 left-0 right-0 z-30 hidden h-10 items-center justify-between border-t border-slate-200 bg-white/95 px-4 text-[11px] text-slate-500 md:flex ${leftClass}`}
    >
      <span>{t("Control Operativo de Limpieza", "Cleaning Operations Control")}</span>
      <span>{t("Derechos reservados 2026", "All rights reserved 2026")}</span>
    </footer>
  )
}

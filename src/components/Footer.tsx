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
      className={`fixed bottom-0 left-0 right-0 z-40 hidden h-11 items-center justify-between border-t border-slate-200/80 bg-white/90 px-4 text-xs text-slate-600 backdrop-blur md:flex ${leftClass}`}
    >
      <span>{t("Control Operativo de Limpieza", "Cleaning Operations Control")}</span>
      <span>{t("Derechos reservados 2026", "All rights reserved 2026")}</span>
    </footer>
  )
}

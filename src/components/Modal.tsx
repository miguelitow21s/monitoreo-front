"use client"

import { ReactNode, useEffect, useId, useRef } from "react"
import { useI18n } from "@/hooks/useI18n"

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
}

export default function Modal({ open, onClose, children, title }: ModalProps) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-slate-800 p-6 text-slate-100 shadow-xl outline-none"
        onClick={e => e.stopPropagation()}
      >
        <h2 id={titleId} className="sr-only">
          {title ?? t("Dialogo", "Dialog")}
        </h2>
        <button
          onClick={onClose}
          aria-label={t("Cerrar", "Close")}
          className="absolute right-3 top-3 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
        >
          {t("Cerrar", "Close")}
        </button>
        {children}
      </div>
    </div>
  )
}

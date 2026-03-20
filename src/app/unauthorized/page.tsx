"use client"

import Link from "next/link"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"

export default function UnauthorizedPage() {
  const { t } = useI18n()
  const { logout } = useAuth()

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#667eea] to-[#764ba2] px-4">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute inset-0 bg-[radial-gradient(circle,_rgba(255,255,255,0.12)_1px,_transparent_1px)] bg-[length:56px_56px]" />
      </div>
      <div className="relative w-full max-w-md rounded-[28px] border border-white/40 bg-white/95 p-8 text-center shadow-2xl backdrop-blur">
        <h1 className="text-2xl font-bold text-slate-900">{t("Acceso no autorizado", "Unauthorized access")}</h1>
        <p className="mt-3 text-sm text-slate-600">
          {t("Tu rol actual no tiene acceso a esta seccion.", "Your current role does not have access to this section.")}
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/dashboard"
            className="rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110"
          >
            {t("Volver al panel", "Back to dashboard")}
          </Link>
          <button
            onClick={logout}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {t("Cerrar sesion", "Sign out")}
          </button>
        </div>
      </div>
    </div>
  )
}

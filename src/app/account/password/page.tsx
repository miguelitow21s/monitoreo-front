"use client"

import { useState } from "react"
import { Manrope } from "next/font/google"

import ProtectedRoute from "@/components/ProtectedRoute"
import Button from "@/components/ui/Button"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { supabase } from "@/services/supabaseClient"

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
})

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {visible ? <path d="M4 4l16 16" /> : null}
    </svg>
  )
}

export default function AccountPasswordPage() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (!user?.email) {
      setError(t("No se encontro usuario autenticado.", "Authenticated user not found."))
      return
    }

    if (!/^\d{6}$/.test(newPassword)) {
      setError(t("El nuevo PIN debe tener 6 digitos numericos.", "New PIN must be 6 numeric digits."))
      return
    }

    if (newPassword !== confirmPassword) {
      setError(t("La confirmacion no coincide con el nuevo PIN.", "Confirmation does not match new PIN."))
      return
    }

    setSubmitting(true)

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      })
      if (signInError) throw new Error(t("El PIN actual es incorrecto.", "Current PIN is incorrect."))

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError

      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setMessage(t("PIN actualizado correctamente.", "PIN updated successfully."))
    } catch (err: unknown) {
      setError(errorMessage(err, t("No se pudo actualizar el PIN.", "Could not update PIN.")))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ProtectedRoute>
      <section className={`flex items-start justify-center px-3 ${manrope.className}`}>
        <div className="w-full max-w-lg space-y-4">
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 px-6 py-6 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">
                {t("Seguridad", "Security")}
              </p>
              <h1 className="mt-2 text-2xl font-extrabold">{t("Cambiar PIN", "Change PIN")}</h1>
              <p className="mt-1 text-sm text-emerald-100">
                {t("Actualiza tu PIN y mantén tu cuenta protegida.", "Update your PIN and keep your account protected.")}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t("PIN actual", "Current PIN")}
                </p>
                <div className="relative rounded-2xl border-2 border-slate-200 bg-white px-3 py-2">
                  <input
                    type={showCurrentPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    inputMode="numeric"
                    maxLength={6}
                    pattern="[0-9]*"
                    placeholder={t("Escribe tu PIN actual", "Type your current PIN")}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-full bg-transparent text-sm text-slate-800 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(prev => !prev)}
                    aria-label={showCurrentPassword ? t("Ocultar PIN", "Hide PIN") : t("Ver PIN", "Show PIN")}
                    className="absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-500/90 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  >
                    <EyeIcon visible={showCurrentPassword} />
                    {showCurrentPassword ? t("Ocultar", "Hide") : t("Ver", "Show")}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t("Nuevo PIN", "New PIN")}
                </p>
                <div className="relative rounded-2xl border-2 border-slate-200 bg-white px-3 py-2">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    inputMode="numeric"
                    maxLength={6}
                    pattern="[0-9]*"
                    placeholder={t("PIN de 6 digitos", "6-digit PIN")}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-full bg-transparent text-sm text-slate-800 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(prev => !prev)}
                    aria-label={showNewPassword ? t("Ocultar PIN", "Hide PIN") : t("Ver PIN", "Show PIN")}
                    className="absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-500/90 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  >
                    <EyeIcon visible={showNewPassword} />
                    {showNewPassword ? t("Ocultar", "Hide") : t("Ver", "Show")}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t("Confirmacion", "Confirmation")}
                </p>
                <div className="relative rounded-2xl border-2 border-slate-200 bg-white px-3 py-2">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    inputMode="numeric"
                    maxLength={6}
                    pattern="[0-9]*"
                    placeholder={t("Repite el PIN", "Repeat the PIN")}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-full bg-transparent text-sm text-slate-800 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(prev => !prev)}
                    aria-label={showConfirmPassword ? t("Ocultar PIN", "Hide PIN") : t("Ver PIN", "Show PIN")}
                    className="absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-500/90 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  >
                    <EyeIcon visible={showConfirmPassword} />
                    {showConfirmPassword ? t("Ocultar", "Hide") : t("Ver", "Show")}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              )}
              {message && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {message}
                </div>
              )}

              <Button
                type="submit"
                disabled={submitting}
                variant="primary"
                fullWidth
                className="h-12 rounded-2xl text-sm"
              >
                {submitting ? t("Guardando...", "Saving...") : t("Guardar nuevo PIN", "Save new PIN")}
              </Button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-xs text-slate-600">
            {t(
              "Sugerencia: no compartas tu PIN y cambialo periodicamente.",
              "Tip: do not share your PIN and update it periodically."
            )}
          </div>
        </div>
      </section>
    </ProtectedRoute>
  )
}

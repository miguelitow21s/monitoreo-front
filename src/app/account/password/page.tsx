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

    if (newPassword.length < 8) {
      setError(t("La nueva contrasena debe tener al menos 8 caracteres.", "New password must be at least 8 characters long."))
      return
    }

    if (newPassword !== confirmPassword) {
      setError(t("La confirmacion no coincide con la nueva contrasena.", "Confirmation does not match new password."))
      return
    }

    setSubmitting(true)

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      })
      if (signInError) throw new Error(t("La contrasena actual es incorrecta.", "Current password is incorrect."))

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError

      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setMessage(t("Contrasena actualizada correctamente.", "Password updated successfully."))
    } catch (err: unknown) {
      setError(errorMessage(err, t("No se pudo actualizar la contrasena.", "Could not update password.")))
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
              <h1 className="mt-2 text-2xl font-extrabold">{t("Cambiar contrasena", "Change password")}</h1>
              <p className="mt-1 text-sm text-emerald-100">
                {t("Actualiza tu acceso y mantiene tu cuenta protegida.", "Update your access and keep your account protected.")}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t("Contrasena actual", "Current password")}
                </p>
                <div className="relative rounded-2xl border-2 border-slate-200 bg-white px-3 py-2">
                  <input
                    type={showCurrentPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder={t("Escribe tu contrasena actual", "Type your current password")}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    className="w-full bg-transparent text-sm text-slate-800 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(prev => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    {showCurrentPassword ? t("Ocultar", "Hide") : t("Ver", "Show")}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {t("Nueva contrasena", "New password")}
                </p>
                <div className="relative rounded-2xl border-2 border-slate-200 bg-white px-3 py-2">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder={t("Minimo 8 caracteres", "At least 8 characters")}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="w-full bg-transparent text-sm text-slate-800 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(prev => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
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
                    minLength={8}
                    autoComplete="new-password"
                    placeholder={t("Repite la nueva contrasena", "Repeat the new password")}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="w-full bg-transparent text-sm text-slate-800 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(prev => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
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
                {submitting ? t("Guardando...", "Saving...") : t("Guardar nueva contrasena", "Save new password")}
              </Button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-xs text-slate-600">
            {t(
              "Sugerencia: usa una contrasena unica con letras y numeros para mayor seguridad.",
              "Tip: use a unique password with letters and numbers for better security."
            )}
          </div>
        </div>
      </section>
    </ProtectedRoute>
  )
}

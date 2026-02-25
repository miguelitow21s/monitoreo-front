"use client"

import { useState } from "react"

import ProtectedRoute from "@/components/ProtectedRoute"
import Card from "@/components/ui/Card"
import Button from "@/components/ui/Button"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { supabase } from "@/services/supabaseClient"

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
      <div className="mx-auto w-full max-w-xl">
        <Card title={t("Cambiar contrasena", "Change password")} subtitle={t("Actualiza las credenciales de tu cuenta actual.", "Update your current account credentials.")}>
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder={t("Contrasena actual", "Current password")}
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder={t("Nueva contrasena (min 8)", "New password (min 8)")}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder={t("Confirmar nueva contrasena", "Confirm new password")}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />

            {error && <p className="text-sm text-red-600">{error}</p>}
            {message && <p className="text-sm text-emerald-700">{message}</p>}

            <div className="pt-2">
              <Button type="submit" disabled={submitting} variant="primary">
                {submitting ? t("Guardando...", "Saving...") : t("Guardar nueva contrasena", "Save new password")}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </ProtectedRoute>
  )
}

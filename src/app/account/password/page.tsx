"use client"

import { useState } from "react"

import ProtectedRoute from "@/components/ProtectedRoute"
import Card from "@/components/ui/Card"
import Button from "@/components/ui/Button"
import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/services/supabaseClient"

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default function AccountPasswordPage() {
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
      setError("No se encontro usuario autenticado.")
      return
    }

    if (newPassword.length < 8) {
      setError("La nueva contrasena debe tener al menos 8 caracteres.")
      return
    }

    if (newPassword !== confirmPassword) {
      setError("La confirmacion no coincide con la nueva contrasena.")
      return
    }

    setSubmitting(true)

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      })
      if (signInError) throw new Error("La contrasena actual es incorrecta.")

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError

      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setMessage("Contrasena actualizada correctamente.")
    } catch (err: unknown) {
      setError(errorMessage(err, "No se pudo actualizar la contrasena."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ProtectedRoute>
      <div className="mx-auto w-full max-w-xl">
        <Card title="Cambiar contrasena" subtitle="Actualiza las credenciales de tu cuenta actual.">
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Contrasena actual"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Nueva contrasena (min 8)"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Confirmar nueva contrasena"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />

            {error && <p className="text-sm text-red-600">{error}</p>}
            {message && <p className="text-sm text-emerald-700">{message}</p>}

            <div className="pt-2">
              <Button type="submit" disabled={submitting} variant="primary">
                {submitting ? "Guardando..." : "Guardar nueva contrasena"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </ProtectedRoute>
  )
}

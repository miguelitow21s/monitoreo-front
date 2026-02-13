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
      setError("No authenticated user found.")
      return
    }

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.")
      return
    }

    if (newPassword !== confirmPassword) {
      setError("Confirmation does not match new password.")
      return
    }

    setSubmitting(true)

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      })
      if (signInError) throw new Error("Current password is incorrect.")

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError

      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setMessage("Password updated successfully.")
    } catch (err: unknown) {
      setError(errorMessage(err, "Could not update password."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ProtectedRoute>
      <div className="mx-auto w-full max-w-xl">
        <Card title="Change password" subtitle="Update credentials for your current account.">
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Current password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="New password (min 8)"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
            />

            {error && <p className="text-sm text-red-600">{error}</p>}
            {message && <p className="text-sm text-emerald-700">{message}</p>}

            <div className="pt-2">
              <Button type="submit" disabled={submitting} variant="primary">
                {submitting ? "Saving..." : "Save new password"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </ProtectedRoute>
  )
}

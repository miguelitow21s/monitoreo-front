"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"

import { supabase } from "@/services/supabaseClient"

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default function RegisterPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setMessage(null)

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            role: "empleado",
            full_name: fullName.trim() || null,
          },
        },
      })

      if (signUpError) throw signUpError

      const userId = data.user?.id
      const userEmail = data.user?.email ?? email

      if (userId) {
        const { error: registerError } = await supabase.rpc("register_employee", {
          p_user_id: userId,
          p_email: userEmail,
          p_full_name: fullName.trim() || null,
        })

        if (registerError) throw registerError
      }

      setMessage(
        "Registro exitoso. Si tu proyecto exige confirmacion por correo, valida tu email antes de iniciar sesion."
      )
      setTimeout(() => router.replace("/auth/login"), 1400)
    } catch (err: unknown) {
      setError(errorMessage(err, "No fue posible completar el registro."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form
        onSubmit={handleRegister}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Registro de empleado
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Crear cuenta</h1>
        <p className="mt-2 text-sm text-slate-600">
          El alta se crea con rol empleado. La activacion la define administracion.
        </p>

        <div className="mt-6 space-y-3">
          <input
            required
            placeholder="Nombre completo"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
          />
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="Correo electronico"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
          />
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Contrasena (min 8)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-800"
          />
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        {message && <div className="mt-3 text-sm text-emerald-700">{message}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
        >
          {submitting ? "Registrando..." : "Crear cuenta"}
        </button>

        <div className="mt-4 text-right text-xs">
          <Link href="/auth/login" className="text-slate-600 underline hover:text-slate-900">
            Volver a login
          </Link>
        </div>
      </form>
    </div>
  )
}


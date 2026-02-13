"use client"

import Link from "next/link"

import { useAuth } from "@/hooks/useAuth"

export default function UnauthorizedPage() {
  const { logout } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Unauthorized access</h1>
        <p className="mt-3 text-sm text-slate-600">
          Your current role does not have access to this section.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Back to dashboard
          </Link>
          <button
            onClick={logout}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

"use client"

import { usePathname, useRouter } from "next/navigation"

type LayoutShellProps = {
  children: React.ReactNode
}

export default function LayoutShell({ children }: LayoutShellProps) {
  const router = useRouter()
  const pathname = usePathname()

  const standalonePage =
    pathname === "/" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/unauthorized") ||
    pathname.startsWith("/clean-control")

  if (standalonePage) {
    return <>{children}</>
  }

  const showHome = pathname !== "/dashboard"

  return (
    <main className="min-h-screen px-3 pb-6 pt-6 sm:px-5 lg:px-6">
      {showHome && (
        <div className="mx-auto mb-5 flex w-full max-w-[1240px] flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Volver atrás
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Volver al inicio
          </button>
        </div>
      )}
      <div className="mx-auto w-full max-w-[1240px]">{children}</div>
    </main>
  )
}

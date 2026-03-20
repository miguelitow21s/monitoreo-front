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

  const showHome = pathname !== "/dashboard" && !pathname.startsWith("/shifts")

  return (
    <main className="wt-app min-h-screen px-3 pb-6 pt-6 sm:px-5 lg:px-6">
      {showHome && (
        <div className="mx-auto mb-5 flex w-full max-w-[1240px] justify-start">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="rounded-full border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 shadow-sm transition hover:bg-slate-700"
          >
            Volver al inicio
          </button>
        </div>
      )}
      <div className="mx-auto w-full max-w-[1240px]">{children}</div>
    </main>
  )
}

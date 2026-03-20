import type { Metadata } from "next"
import { Suspense } from "react"
import "./globals.css"

import ClientProviders from "@/components/ClientProviders"
import LayoutShell from "@/components/LayoutShell"

export const metadata: Metadata = {
  title: "WorkTrace - Gestión de Limpieza",
  description: "Gestión Profesional de Limpieza",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className="min-h-screen bg-slate-950 text-slate-100">
        <ClientProviders>
          <Suspense fallback={null}>
            <LayoutShell>{children}</LayoutShell>
          </Suspense>
        </ClientProviders>
      </body>
    </html>
  )
}

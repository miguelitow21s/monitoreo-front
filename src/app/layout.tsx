import type { Metadata } from "next"
import "./globals.css"

import ClientProviders from "@/components/ClientProviders"
import LayoutShell from "@/components/LayoutShell"

export const metadata: Metadata = {
  title: "Sistema de Control de Aseo",
  description: "Plataforma de control operativo por horas",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-100 text-slate-900">
        <ClientProviders>
          <LayoutShell>{children}</LayoutShell>
        </ClientProviders>
      </body>
    </html>
  )
}

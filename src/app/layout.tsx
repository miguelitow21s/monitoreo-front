import type { Metadata } from "next"
import "./globals.css"

import ClientProviders from "@/components/ClientProviders"
import LayoutShell from "@/components/LayoutShell"

export const metadata: Metadata = {
  title: "Cleaning Operations Control",
  description: "Hourly operational control platform",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-100 text-slate-900">
        <ClientProviders>
          <LayoutShell>{children}</LayoutShell>
        </ClientProviders>
      </body>
    </html>
  )
}

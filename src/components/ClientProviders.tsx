"use client"

import { LanguageProvider } from "@/context/LanguageContext"
import ToastProvider from "@/components/toast/ToastProvider"

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <ToastProvider>{children}</ToastProvider>
    </LanguageProvider>
  )
}

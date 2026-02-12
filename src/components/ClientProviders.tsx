"use client"

import ToastProvider from "@/components/toast/ToastProvider"

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>
}

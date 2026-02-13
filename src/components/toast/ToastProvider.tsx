"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"

type ToastType = "success" | "error" | "info"

type ToastItem = {
  id: number
  type: ToastType
  message: string
}

type ToastContextValue = {
  showToast: (type: ToastType, message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider")
  }
  return context
}

function toastClasses(type: ToastType) {
  if (type === "success") return "border-emerald-300 bg-emerald-50 text-emerald-800"
  if (type === "error") return "border-red-300 bg-red-50 text-red-700"
  return "border-blue-300 bg-blue-50 text-blue-800"
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const showToast = useCallback((type: ToastType, message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setItems(prev => [...prev, { id, type, message }])
    window.setTimeout(() => {
      setItems(prev => prev.filter(item => item.id !== id))
    }, 3500)
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-20 z-[70] flex w-full max-w-sm flex-col gap-2">
        {items.map(item => (
          <div
            key={item.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-sm ${toastClasses(item.type)}`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

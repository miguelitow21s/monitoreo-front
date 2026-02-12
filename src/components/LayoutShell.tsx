"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"

import Header from "@/components/Header"
import Sidebar from "@/components/Sidebar"
import Footer from "@/components/Footer"

type LayoutShellProps = {
  children: React.ReactNode
}

export default function LayoutShell({ children }: LayoutShellProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const standalonePage =
    pathname === "/" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/unauthorized")

  if (standalonePage) {
    return <>{children}</>
  }

  const desktopOffset = collapsed ? "md:ml-20" : "md:ml-64"

  return (
    <>
      <Header
        collapsed={collapsed}
        onToggleDesktop={() => setCollapsed(v => !v)}
        onToggleMobile={() => setMobileOpen(v => !v)}
      />
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggle={setCollapsed}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <main
        className={`min-h-screen px-4 pb-6 pt-20 transition-all duration-300 sm:px-6 md:pb-16 ${desktopOffset}`}
      >
        {children}
      </main>
      <Footer collapsed={collapsed} />
    </>
  )
}

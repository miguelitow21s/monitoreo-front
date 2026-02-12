"use client"

import { useState } from "react"

import Header from "@/components/Header"
import Sidebar from "@/components/Sidebar"
import Footer from "@/components/Footer"

type LayoutShellProps = {
  children: React.ReactNode
}

export default function LayoutShell({ children }: LayoutShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  const sidebarWidth = collapsed ? "ml-16" : "ml-64"

  return (
    <>
      <Header />
      <Sidebar collapsed={collapsed} onToggle={setCollapsed} />
      <main
        className={`px-6 pt-24 pb-20 transition-all duration-300 ${sidebarWidth}`}
      >
        {children}
      </main>
      <Footer collapsed={collapsed} />
    </>
  )
}

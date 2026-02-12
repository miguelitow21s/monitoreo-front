"use client"

type FooterProps = {
  collapsed: boolean
}

export default function Footer({ collapsed }: FooterProps) {
  const leftClass = collapsed ? "left-16" : "left-64"

  return (
    <footer
      className={`fixed bottom-0 right-0 z-50 flex h-12 items-center justify-center bg-gray-900 text-white shadow-md transition-all duration-300 ${leftClass}`}
    >
      <span className="text-sm">
        Copyright 2026 Empresa de Aseo. Todos los derechos reservados.
      </span>
    </footer>
  )
}

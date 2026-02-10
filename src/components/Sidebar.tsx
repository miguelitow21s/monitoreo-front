"use client";
"use client";
import { useState } from "react";
import Link from "next/link";
import { ROLES } from "../utils/permissions";

interface SidebarProps {
  role: string;
}

const menu: Record<string, { label: string; href: string }[]> = {
  [ROLES.SUPERADMIN]: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Restaurantes", href: "/restaurants" },
    { label: "Usuarios", href: "/users" },
    { label: "Reportes", href: "/reports" },
  ],
  [ROLES.SUPERVISORA]: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Turnos", href: "/shifts" },
    { label: "Insumos", href: "/supplies" },
  ],
  [ROLES.EMPLEADO]: [
    { label: "Mi Turno", href: "/shifts" },
  ],
};

export default function Sidebar({ role }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const items = menu[role] || [];

  return (
    <aside className={`h-screen bg-gray-900 text-white ${collapsed ? "w-16" : "w-64"}`}>
      <button
        className="p-2 text-sm"
        onClick={() => setCollapsed(!collapsed)}
      >
        ☰
      </button>

      <nav className="mt-4 flex flex-col gap-2">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="px-4 py-2 hover:bg-gray-700">
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
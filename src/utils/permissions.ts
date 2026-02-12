export const ROLES = {
  SUPER_ADMIN: "super_admin",
  SUPERVISORA: "supervisora",
  EMPLEADO: "empleado",
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

const permissions: Record<Role, string[]> = {
  super_admin: [
    "/dashboard",
    "/restaurants",
    "/users",
    "/shifts",
    "/supplies",
    "/reports",
  ],
  supervisora: [
    "/dashboard",
    "/shifts",
    "/supplies",
    "/reports",
  ],
  empleado: [
    "/dashboard",
    "/shifts",
  ],
}

/**
 * 🔐 Type guard: valida si un string es un Role válido
 */
export function isRole(value: string): value is Role {
  return Object.values(ROLES).includes(value as Role)
}

export function hasAccess(role: Role, pathname: string): boolean {
  return permissions[role].some(route =>
    pathname.startsWith(route)
  )
}

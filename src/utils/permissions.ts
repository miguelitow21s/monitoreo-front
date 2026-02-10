export const ROLES = {
  SUPERADMIN: 'superadmin',
  SUPERVISORA: 'supervisora',
  EMPLEADO: 'empleado',
};

export const rolePermissions = {
  [ROLES.SUPERADMIN]: [
    '/dashboard',
    '/restaurants',
    '/users',
    '/shifts',
    '/reports',
  ],
  [ROLES.SUPERVISORA]: [
    '/dashboard',
    '/shifts',
    '/supplies',
    '/incidents',
  ],
  [ROLES.EMPLEADO]: [
    '/dashboard',
    '/shifts',
    '/history',
  ],
};

export function isRouteAllowed(role: string, pathname: string) {
  return rolePermissions[role]?.includes(pathname);
}

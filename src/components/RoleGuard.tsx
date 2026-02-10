import { useAuth } from '../hooks/useSession';
import { ROLES, isRouteAllowed } from '../utils/permissions';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

export default function RoleGuard({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }) {
  const { session, role } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!session) {
      router.push('/auth/login');
    } else if (role && !allowedRoles.includes(role)) {
      router.push('/unauthorized');
    } else if (role && !isRouteAllowed(role, pathname)) {
      router.push('/unauthorized');
    }
  }, [session, role, allowedRoles, pathname, router]);

  if (!session || !role || !allowedRoles.includes(role) || !isRouteAllowed(role, pathname)) return null;

  return <>{children}</>;
}

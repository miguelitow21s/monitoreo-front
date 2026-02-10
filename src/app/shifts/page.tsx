import { useAuth } from '../../hooks/useSession';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ShiftsPage() {
  const { session, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!session) {
      router.push('/auth/login');
    }
  }, [session, router]);

  if (!session) return null;

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-4">Turnos</h2>
      <div className="bg-white rounded shadow p-6">
        <p>Gestión de turnos por rol: {role}</p>
      </div>
    </div>
  );
}

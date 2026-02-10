"use client";

import { useAuth } from "@/hooks/useSession";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DashboardPage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/auth/login");
    }
  }, [session, loading, router]);

  if (loading) return null;
  if (!session) return null;

  return (
    <div>
      <h1>Dashboard</h1>
    </div>
  );
}

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";

/**
 * Gate for the whole app (Slice 8). While `/auth/me` is in flight, show a quiet placeholder;
 * once resolved, render the children if authenticated, else redirect to /login (remembering
 * where we came from so login can send the user back).
 */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 text-gray-500">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

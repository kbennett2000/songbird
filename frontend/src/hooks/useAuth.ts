import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api";
import { type Credentials, fetchMe, login, logout, register } from "@/lib/auth";
import type { User } from "@/schemas";

const ME_KEY = ["auth", "me"];

export interface UseAuth {
  user: User | undefined;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (creds: Credentials) => Promise<User>;
  register: (creds: Credentials) => Promise<User>;
  logout: () => Promise<void>;
}

/**
 * Auth state, backed by a `/auth/me` query. A 401 is the signed-out state — not an error to
 * retry — so the query swallows it to `null` and never retries it.
 */
export function useAuth(): UseAuth {
  const queryClient = useQueryClient();

  const meQuery = useQuery<User | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await fetchMe();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (user) => queryClient.setQueryData(ME_KEY, user),
  });

  const registerMutation = useMutation({
    mutationFn: register,
    onSuccess: (user) => queryClient.setQueryData(ME_KEY, user),
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // Drop the session-scoped cache so another login starts clean.
      queryClient.setQueryData(ME_KEY, null);
      queryClient.removeQueries({ queryKey: ["chapter"] });
      queryClient.removeQueries({ queryKey: ["annotations"] });
      queryClient.removeQueries({ queryKey: ["tags"] });
    },
  });

  const user = meQuery.data ?? undefined;
  return {
    user,
    isLoading: meQuery.isPending,
    isAuthenticated: user !== undefined,
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
  };
}

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api";
import { type Credentials, fetchMe, login, logout, register } from "@/lib/auth";
import type { User } from "@/schemas";

/** The signed-in user's cache entry — `User`, or `null` when signed out. */
export const ME_KEY = ["auth", "me"];

/**
 * Drop everything cached except the signed-in user. Notes, sermons and search results belong to
 * one person, so none of them may outlive a change of who is signed in; the Concord data that
 * goes with them is cheap to fetch again.
 */
function dropCachedData(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
}

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

  const signedIn = (user: User) => {
    dropCachedData(queryClient);
    queryClient.setQueryData(ME_KEY, user);
  };

  const loginMutation = useMutation({ mutationFn: login, onSuccess: signedIn });

  const registerMutation = useMutation({ mutationFn: register, onSuccess: signedIn });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // So another login starts clean.
      queryClient.setQueryData(ME_KEY, null);
      dropCachedData(queryClient);
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

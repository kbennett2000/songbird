import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { useAuth } from "@/hooks/useAuth";
import { server } from "@/test/msw/server";

const USER = {
  id: 1,
  username: "kris",
  is_admin: true,
  last_translation: null,
  last_book: null,
  last_chapter: null,
  created_at: "2026-01-01T00:00:00Z",
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useAuth", () => {
  it("populates the user from /auth/me", async () => {
    server.use(http.get("/api/v1/auth/me", () => HttpResponse.json({ user: USER })));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.user?.username).toBe("kris");
  });

  it("treats a 401 as signed-out (not an error)", async () => {
    server.use(
      http.get("/api/v1/auth/me", () =>
        HttpResponse.json({ detail: { code: "NOT_AUTHENTICATED", message: "no" } }, { status: 401 }),
      ),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeUndefined();
  });

  it("login refetches the user; logout clears it", async () => {
    let signedIn = false;
    server.use(
      http.get("/api/v1/auth/me", () =>
        signedIn
          ? HttpResponse.json({ user: USER })
          : HttpResponse.json({ detail: { code: "NOT_AUTHENTICATED", message: "no" } }, { status: 401 }),
      ),
      http.post("/api/v1/auth/login", () => {
        signedIn = true;
        return HttpResponse.json({ user: USER });
      }),
      http.post("/api/v1/auth/logout", () => {
        signedIn = false;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);

    await act(async () => {
      await result.current.login({ username: "kris", password: "supersecret" });
    });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.logout();
    });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(false));
  });
});

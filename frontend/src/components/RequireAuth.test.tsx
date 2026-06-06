import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { RequireAuth } from "@/components/RequireAuth";
import { server } from "@/test/msw/server";

function renderGated() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <div>protected reader</div>
              </RequireAuth>
            }
          />
          <Route path="/login" element={<div>login screen</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RequireAuth", () => {
  it("renders children when authenticated", async () => {
    server.use(
      http.get("/api/v1/auth/me", () =>
        HttpResponse.json({ user: { id: 1, username: "kris", is_admin: true, created_at: "x" } }),
      ),
    );
    renderGated();
    expect(await screen.findByText("protected reader")).toBeInTheDocument();
  });

  it("redirects to /login when unauthenticated", async () => {
    server.use(
      http.get("/api/v1/auth/me", () =>
        HttpResponse.json({ detail: { code: "NOT_AUTHENTICATED", message: "no" } }, { status: 401 }),
      ),
    );
    renderGated();
    expect(await screen.findByText("login screen")).toBeInTheDocument();
    expect(screen.queryByText("protected reader")).not.toBeInTheDocument();
  });
});
